import {
    CADASTRO_ENRIQUECIMENTO_QUEUE,
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    CHECKIN_EXCHANGE,
    opcoesFilaEnriquecimento,
} from './infra/messaging/rabbit-mq/fila'
import {
    FastifyAdapter,
    NestFastifyApplication,
} from '@nestjs/platform-fastify'

import { AppModule } from './app.module'
import { NestFactory } from '@nestjs/core'
import { Transport } from '@nestjs/microservices'
import { ValidationPipe } from '@nestjs/common'

async function server() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
    )

    app.connectMicroservice({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.BROKER_URL ?? 'amqp://localhost:5672'],
            exchange: CHECKIN_EXCHANGE,
            exchangeType: 'topic',
            wildcards: true,
            queue: CADASTRO_ENRIQUECIMENTO_QUEUE,
            queueOptions: opcoesFilaEnriquecimento(),
routingKey: CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            noAck: true,
            prefetchCount: 1,
        },
    })

    app.useGlobalPipes(new ValidationPipe({}))

    app.enableShutdownHooks()

    await app.startAllMicroservices()
    await app.listen(process.env.PORT ?? 3000, '0.0.0.0')
}
await server()
