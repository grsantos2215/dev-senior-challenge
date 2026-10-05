import { Injectable, Logger } from '@nestjs/common'
import { PublicadorDeEventosPort } from '@/application/services/outbox/publicador-de-eventos.port'
import { RabbitPublisher } from '../rabbit-publisher'

@Injectable()
export class RabbitPublicadorDeEventosAdapter
    implements PublicadorDeEventosPort
{
    private readonly logger = new Logger(RabbitPublicadorDeEventosAdapter.name)

    constructor(private readonly publisher: RabbitPublisher) {}

    async publicar(
        routingKey: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        await this.publisher.publicarOuFalhar(routingKey, payload)
    }
}