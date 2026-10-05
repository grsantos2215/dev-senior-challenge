import {
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    MAX_TENTATIVAS,
} from '@/infra/messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from '@/application/services/cadastro-de-paciente/errors'

import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CadastroPort } from '@/application/services/cadastro-de-paciente/cadastro.port'
import { ConfigService } from '@nestjs/config'
import { Controller } from '@nestjs/common'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { EventPattern } from '@nestjs/microservices'
import { Logger } from '@nestjs/common'
import type { MensagemEnriquecimento } from '@/infra/messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import { PacienteRepository } from '@/application/repositories/paciente-repository'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

const INTERVALO_PADRAO_MS = 2_200

export type ResultadoEnriquecimento =
    | { status: 'enriquecido' }
    | {
          status: 'descartado'
          motivo: 'paciente-inexistente' | 'ja-confirmado' | 'cpf-desconhecido'
      }
    | { status: 'adiado'; tentativa: number }
    | { status: 'desistido'; tentativas: number }
    | { status: 'falha'; motivo: string }

@Controller()
export class CadastroEnriquecimentoConsumidor {
    private readonly logger = new Logger(CadastroEnriquecimentoConsumidor.name)
    private readonly intervaloMinimoMs: number
    private ultimoChamadoEm = 0

    constructor(
        private readonly pacientes: PacienteRepository,
        private readonly cadastro: CadastroPort,
        private readonly publisher: EnriquecimentoDeCadastroPort,
        private readonly auditoria: AuditoriaPort,
        config: ConfigService,
    ) {
        this.intervaloMinimoMs =
            Number(config.get('CADASTRO_INTERVALO_MIN_MS')) ||
            INTERVALO_PADRAO_MS
    }

    @EventPattern(CADASTRO_ENRIQUECIMENTO_ROUTING_KEY)
    async handle(
        mensagem: MensagemEnriquecimento,
    ): Promise<ResultadoEnriquecimento> {
        const { pacienteId, tentativa } = mensagem

        const paciente = await this.pacientes.findById(pacienteId)

        if (!paciente) {
            this.logger.warn(
                `paciente ${pacienteId} nao existe mais, descarto enriquecimento`,
            )
            return { status: 'descartado', motivo: 'paciente-inexistente' }
        }

        if (paciente.cadastroConfirmado) {
            return { status: 'descartado', motivo: 'ja-confirmado' }
        }

        await this.aguardarTurno()

        try {
            const cadastrado = await this.cadastro.buscarPorCpf(paciente.cpf)

            if (!cadastrado) {
                this.logger.warn(
                    `cadastro não conhece o paciente, fica degradado`,
                )
                return { status: 'descartado', motivo: 'cpf-desconhecido' }
            }

            paciente.nome = cadastrado.nome
            paciente.dataNascimento = cadastrado.dataNascimento
            await this.pacientes.save(paciente)

            await this.auditoria.registrar(
                new RegistroAuditoria(
                    'CADASTRO_CONSULTADO',
                    { tentativa },
                    null,
                    pacienteId,
                ),
            )

            this.logger.log(
                `cadastro enriquecido pacienteId=${pacienteId} tentativa=${tentativa}`,
            )
            return { status: 'enriquecido' }
        } catch (erro) {
            return await this.tratarFalha(erro, pacienteId, tentativa)
        }
    }

    private async tratarFalha(
        erro: unknown,
        pacienteId: string,
        tentativa: number,
    ): Promise<ResultadoEnriquecimento> {
        if (erro instanceof PacienteNaoEncontrado) {
            this.logger.warn(
                `cadastro não conhece o pacienteId=${pacienteId}, descarto enriquecimento`,
            )
            await this.auditoria.registrar(
                new RegistroAuditoria(
                    'INTEGRACAO_FALHOU',
                    {
                        integracao: 'cadastro',
                        erro: erro.constructor.name,
                        tentativa,
                        definitivo: true,
                    },
                    null,
                    pacienteId,
                ),
            )
            return { status: 'descartado', motivo: 'cpf-desconhecido' }
        }

        const conhecido =
            erro instanceof CadastroRateLimitado ||
            erro instanceof CadastroIndisponivel

        if (!conhecido) {
            this.logger.error(
                `falha inesperada enriquecendo pacienteId=${pacienteId}`,
                erro instanceof Error ? erro.stack : undefined,
            )
            await this.auditoria.registrar(
                new RegistroAuditoria(
                    'INTEGRACAO_FALHOU',
                    {
                        integracao: 'cadastro',
                        erro: (erro as Error).constructor.name,
                        tentativa,
                        inesperada: true,
                    },
                    null,
                    pacienteId,
                ),
            )
            return { status: 'falha', motivo: (erro as Error).message }
        }

        if (tentativa >= MAX_TENTATIVAS) {
            this.logger.warn(
                `desistência de enriquecimento pacienteId=${pacienteId} após ${tentativa} tentativas: ${(erro as Error).message}`,
            )
            await this.auditoria.registrar(
                new RegistroAuditoria(
                    'INTEGRACAO_FALHOU',
                    {
                        integracao: 'cadastro',
                        erro: (erro as Error).constructor.name,
                        tentativa,
                        desistencia: true,
                    },
                    null,
                    pacienteId,
                ),
            )
            return { status: 'desistido', tentativas: tentativa }
        }

        this.logger.warn(
            `reenfileiro pacienteId=${pacienteId} tentativa=${tentativa + 1}: ${(erro as Error).message}`,
        )
        await this.auditoria.registrar(
            new RegistroAuditoria(
                'INTEGRACAO_FALHOU',
                {
                    integracao: 'cadastro',
                    erro: (erro as Error).constructor.name,
                    tentativa,
                },
                null,
                pacienteId,
            ),
        )
        await this.publisher.enfileirar(pacienteId, tentativa + 1)
        return { status: 'adiado', tentativa: tentativa + 1 }
    }

    private async aguardarTurno(): Promise<void> {
        const desde = Date.now() - this.ultimoChamadoEm
        const espera = this.intervaloMinimoMs - desde

        if (espera > 0)
            await new Promise((resolve) => setTimeout(resolve, espera))

        this.ultimoChamadoEm = Date.now()
    }
}
