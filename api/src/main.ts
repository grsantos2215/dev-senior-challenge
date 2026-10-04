import {
    CADASTRO_ENRIQUECIMENTO_QUEUE,
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    CHECKIN_EXCHANGE,
    opcoesFilaEnriquecimento,
} from './infra/messaging/rabbit-mq/fila.js'
import {
    FastifyAdapter,
    NestFastifyApplication,
} from '@nestjs/platform-fastify'

import { AppModule } from './app.module.js'
import { NestFactory } from '@nestjs/core'
import { Transport } from '@nestjs/microservices'
import { ValidationPipe } from '@nestjs/common'

async function server() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
    )

    // Consumidor AMQP no mesmo processo do HTTP.
    //
    // `queue` + `queueOptions` sao obrigatorios porque `queue.bind` e
    // `queue.consume` exigem fila existente: sem `queueOptions` o broker
    // responde NOT_FOUND e o processo morre no startup. Declarar aqui, e nao
    // em `onApplicationBootstrap`, porque o `ServerRMQ` faz bind e consume em
    // `startAllMicroservices()`, que roda antes do `listen()`.
    //
    // `prefetchCount: 1` e deliberado: o consumidor controla o ritmo do rate
    // limit do mock na mao, e paralelo aqui viraria rajada.
    app.connectMicroservice({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.BROKER_URL ?? 'amqp://localhost:5672'],
            exchange: CHECKIN_EXCHANGE,
            exchangeType: 'topic',
            // `wildcards: true` faz o Nest usar a routing key da mensagem como
            // pattern do `@EventPattern`, em vez de comparar com um padrao
            // fixo. E o que permite tratar por pattern.
            wildcards: true,
            queue: CADASTRO_ENRIQUECIMENTO_QUEUE,
            // Mesmo objeto de `fila.ts` que a funcao de topologia usa: o broker
            // exige argumentos identicos em toda declaracao da fila.
            queueOptions: opcoesFilaEnriquecimento(),
            routingKey: CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            // Ack manual: o consumidor decide. Com `noAck: true` uma falha de
            // processo perderia a mensagem sem ninguem perceber.
            noAck: false,
            prefetchCount: 1,
        },
    })

    app.useGlobalPipes(new ValidationPipe({}))

    app.enableShutdownHooks()

    await app.startAllMicroservices()
    await app.listen(process.env.PORT ?? 3000)
}
await server()
