import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ClientRMQ } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'

import { CADASTRO_ENRIQUECIMENTO_ROUTING_KEY } from './fila'
import { RMQ_CLIENT } from './checkin-events.publisher'

export { CADASTRO_ENRIQUECIMENTO_ROUTING_KEY }

export interface MensagemEnriquecimento {
    pacienteId: string
    tentativa: number
}

export const MAX_TENTATIVAS = 3

@Injectable()
export class CadastroEnriquecimentoPublisher extends EnriquecimentoDeCadastroPort {
    private readonly logger = new Logger(CadastroEnriquecimentoPublisher.name)

    constructor(@Inject(RMQ_CLIENT) private readonly client: ClientRMQ) {
        super()
    }

    async enfileirar(pacienteId: string, tentativa = 1): Promise<void> {
        const mensagem: MensagemEnriquecimento = { pacienteId, tentativa }

        try {
            await firstValueFrom(
                this.client.emit(CADASTRO_ENRIQUECIMENTO_ROUTING_KEY, mensagem),
            )
        } catch (erro) {
            this.logger.error(
                `falha ao enfileirar enriquecimento pacienteId=${pacienteId} tentativa=${tentativa}`,
                erro instanceof Error ? erro.stack : undefined,
            )
            throw erro
        }
    }
}
