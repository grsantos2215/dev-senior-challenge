import {
    CheckinEventsPublisher,
    RMQ_CLIENT,
    createRmqClient,
} from './rabbit-mq/checkin-events.publisher'

import { ConfigService } from '@nestjs/config'
import { Module } from '@nestjs/common'
import { RabbitPublisher } from './rabbit-publisher'
import { TopologiaEnriquecimento } from './rabbit-mq/topologia-enriquecimento'

@Module({
    providers: [
        {
            provide: RMQ_CLIENT,
            useFactory: (config: ConfigService) => createRmqClient(config),
            inject: [ConfigService],
        },
        RabbitPublisher,
        CheckinEventsPublisher,
        TopologiaEnriquecimento,
    ],
    exports: [CheckinEventsPublisher, RMQ_CLIENT, RabbitPublisher],
})
export class MessagingModule {}
