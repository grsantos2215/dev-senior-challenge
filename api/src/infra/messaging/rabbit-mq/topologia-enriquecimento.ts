import {
    Inject,
    Injectable,
    Logger,
    OnApplicationBootstrap,
} from '@nestjs/common'
import { ClientRMQ } from '@nestjs/microservices'
import type { ConfirmChannel } from 'amqplib'

import { RMQ_CLIENT } from './checkin-events.publisher'
import { declararTopologiaEnriquecimento } from './fila'

/**
 * Declara exchange, filas e bindings antes de o consumidor comecar a consumir.
 */
@Injectable()
export class TopologiaEnriquecimento implements OnApplicationBootstrap {
    private readonly logger = new Logger(TopologiaEnriquecimento.name)

    constructor(@Inject(RMQ_CLIENT) private readonly client: ClientRMQ) {}

    async onApplicationBootstrap(): Promise<void> {
        try {
            // `ClientProxy` conecta por demanda, nao na construcao. Sem este
            // `connect()` o `channel` ainda e `null` aqui e a declaracao
            // estoura em `assertExchange`.
            await this.client.connect()

            const channel = (
                this.client as unknown as { channel: ConfirmChannel }
            ).channel

            await declararTopologiaEnriquecimento(channel)
            this.logger.log('topologia de enriquecimento declarada')
        } catch (erro) {
            this.logger.error(
                'falha ao declarar topologia de enriquecimento',
                erro instanceof Error ? erro.stack : undefined,
            )
            throw erro
        }
    }
}
