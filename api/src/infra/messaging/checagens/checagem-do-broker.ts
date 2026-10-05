import { ChecagemDeDependencia } from '@/application/services/saude/saude.service'
import { Injectable } from '@nestjs/common'
import { RabbitPublisher } from '@/infra/messaging/rabbit-publisher'

@Injectable()
export class ChecagemDoBroker implements ChecagemDeDependencia {
    readonly nome = 'rabbitmq'

    constructor(private readonly publisher: RabbitPublisher) {}

    async verificar(): Promise<void> {
        if (!this.publisher.estaConectado()) {
            throw new Error('canal do broker indisponível')
        }
    }
}
