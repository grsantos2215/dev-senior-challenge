import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { Injectable, Logger } from '@nestjs/common'

import { CADASTRO_ENRIQUECIMENTO_ROUTING_KEY } from './fila'
import { RabbitPublisher } from '../rabbit-publisher'

export { CADASTRO_ENRIQUECIMENTO_ROUTING_KEY }

export interface MensagemEnriquecimento {
    pacienteId: string
    tentativa: number
}

export const MAX_TENTATIVAS = 3

@Injectable()
export class CadastroEnriquecimentoPublisher extends EnriquecimentoDeCadastroPort {
    private readonly logger = new Logger(CadastroEnriquecimentoPublisher.name)

    constructor(private readonly publisher: RabbitPublisher) {
        super()
    }

    async enfileirar(pacienteId: string, tentativa = 1): Promise<void> {
        const mensagem: MensagemEnriquecimento = { pacienteId, tentativa }

        try {
            await this.publisher.publicarOuFalhar(
                CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
                mensagem,
            )
        } catch (erro) {
            this.logger.error(
                `falha ao reenfileirar enriquecimento pacienteId=${pacienteId} tentativa=${tentativa}`,
                erro instanceof Error ? erro.stack : undefined,
            )
        }
    }

    async enfileirarSemBloquear(pacienteId: string): Promise<void> {
        try {
            await this.publisher.publicar(CADASTRO_ENRIQUECIMENTO_ROUTING_KEY, {
                pacienteId,
                tentativa: 1,
            } satisfies MensagemEnriquecimento)
        } catch (erro) {
            this.logger.warn(
                `enfileiramento de enriquecimento falhou pacienteId=${pacienteId}: ${
                    erro instanceof Error ? erro.message : String(erro)
                }. O paciente fica degradado e o próximo check-in reenfileira.`,
            )
        }
    }
}
