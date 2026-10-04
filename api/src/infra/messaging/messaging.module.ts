import {
    CheckinEventsPublisher,
    RMQ_CLIENT,
    createRmqClient,
} from './rabbit-mq/checkin-events.publisher.js'

import { ConfigService } from '@nestjs/config'
import { Module } from '@nestjs/common'
import { TopologiaEnriquecimento } from './rabbit-mq/topologia-enriquecimento.js'

@Module({
    providers: [
        {
            provide: RMQ_CLIENT,
            useFactory: (config: ConfigService) => createRmqClient(config),
            inject: [ConfigService],
        },
        CheckinEventsPublisher,
        // Declara filas e bindings no `onApplicationBootstrap`.
        TopologiaEnriquecimento,
    ],
    exports: [CheckinEventsPublisher, RMQ_CLIENT],
})
export class MessagingModule {}
