import {
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    MAX_TENTATIVAS,
} from '@/infra/messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from '@/application/services/cadastro-de-paciente/errors'
import { Injectable, Logger } from '@nestjs/common'

import { CadastroPort } from '@/application/services/cadastro-de-paciente/cadastro.port'
import { ConfigService } from '@nestjs/config'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { EventPattern } from '@nestjs/microservices'
import type { MensagemEnriquecimento } from '@/infra/messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

const INTERVALO_PADRAO_MS = 2_200

@Injectable()
export class CadastroEnriquecimentoConsumidor {
    private readonly logger = new Logger(CadastroEnriquecimentoConsumidor.name)
    private readonly intervaloMinimoMs: number
    private ultimoChamadoEm = 0

    constructor(
        private readonly pacientes: PacienteRepository,
        private readonly cadastro: CadastroPort,
        // A porta, e não a classe concreta: quem reenfileira só precisa saber
        // enfileirar, e o token já está ligado no módulo.
        private readonly publisher: EnriquecimentoDeCadastroPort,
        config: ConfigService,
    ) {
        this.intervaloMinimoMs =
            Number(config.get('CADASTRO_INTERVALO_MIN_MS')) ||
            INTERVALO_PADRAO_MS
    }

    @EventPattern(CADASTRO_ENRIQUECIMENTO_ROUTING_KEY)
    async handle(mensagem: MensagemEnriquecimento): Promise<void> {
        const { pacienteId, tentativa } = mensagem

        const paciente = await this.pacientes.findById(pacienteId)

        if (!paciente) {
            this.logger.warn(
                `paciente ${pacienteId} nao existe mais, descarto enriquecimento`,
            )
            return
        }

        // Idempotência: reenfileirar é normal e esperado, então o consumidor
        // pode receber o mesmo paciente várias vezes.
        if (paciente.cadastroConfirmado) return

        await this.aguardarTurno()

        try {
            const cadastrado = await this.cadastro.buscarPorCpf(paciente.cpf)

            if (!cadastrado) {
                this.logger.warn(
                    `cadastro nao conhece o cpf=${paciente.cpf}, fica degradado`,
                )
                return
            }

            paciente.nome = cadastrado.nome
            paciente.dataNascimento = cadastrado.dataNascimento
            await this.pacientes.save(paciente)

            this.logger.log(
                `cadastro enriquecido pacienteId=${pacienteId} tentativa=${tentativa}`,
            )
        } catch (erro) {
            await this.tratarFalha(erro, pacienteId, tentativa)
        }
    }

    private async tratarFalha(
        erro: unknown,
        pacienteId: string,
        tentativa: number,
    ): Promise<void> {
        const conhecido =
            erro instanceof CadastroRateLimitado ||
            erro instanceof CadastroIndisponivel ||
            erro instanceof PacienteNaoEncontrado

        if (!conhecido) {
            // Bug no adapter não vira retry infinito. Log e deixa o paciente
            // degradado; o próximo check-in reenfileira.
            this.logger.error(
                `falha inesperada enriquecendo pacienteId=${pacienteId}`,
                erro instanceof Error ? erro.stack : undefined,
            )
            return
        }

        if (tentativa >= MAX_TENTATIVAS) {
            this.logger.warn(
                `desisto de enriquecer pacienteId=${pacienteId} apos ${tentativa} tentativas: ${(erro as Error).message}`,
            )
            return
        }

        // Reenfileira em vez de reenviar direto: a mensagem volta pela fila,
        // então o ritmo do `aguardarTurno` volta a valer. Reenviar direto
        // viraria loop quente contra o rate limit.
        this.logger.warn(
            `reenfileiro pacienteId=${pacienteId} tentativa=${tentativa + 1}: ${(erro as Error).message}`,
        )
        await this.publisher.enfileirar(pacienteId, tentativa + 1)
    }

    private async aguardarTurno(): Promise<void> {
        const desde = Date.now() - this.ultimoChamadoEm
        const espera = this.intervaloMinimoMs - desde

        if (espera > 0)
            await new Promise((resolve) => setTimeout(resolve, espera))

        this.ultimoChamadoEm = Date.now()
    }
}
