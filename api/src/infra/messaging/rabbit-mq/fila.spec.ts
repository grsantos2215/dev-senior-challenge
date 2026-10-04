import {
    CADASTRO_ENRIQUECIMENTO_QUEUE,
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    CHECKIN_EXCHANGE,
    declararTopologiaEnriquecimento,
} from './fila'
import type { ConfirmChannel, ConsumeMessage } from 'amqplib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Prova de que a topologia de enriquecimento existe e e duravel.
 *
 * Fala com o broker de verdade: mock nenhum prova retenção, ja que o defeito
 * era justamente a fila nao existir. Sem fila declarada o broker aceita a
 * publicação e descarta a mensagem, e o unico sintoma visivel e um paciente que
 * nunca ganha nome.
 */
import { ClientRMQ } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'

describe('topologia de enriquecimento', () => {
    let client: ClientRMQ
    let channel: ConfirmChannel

    beforeAll(async () => {
        client = new ClientRMQ({
            urls: [process.env.BROKER_URL ?? 'amqp://localhost:5672'],
            exchange: CHECKIN_EXCHANGE,
            exchangeType: 'topic',
            wildcards: true,
            persistent: true,
        })

        await client.connect()
        await client.createChannel()
        channel = (client as unknown as { channel: ConfirmChannel }).channel
    })

    afterAll(async () => {
        await client.close()
    })

    it('a declaração é idempotente (sobe duas vezes sem erro)', async () => {
        await declararTopologiaEnriquecimento(channel)
        await expect(
            declararTopologiaEnriquecimento(channel),
        ).resolves.toBeUndefined()
    })

    it('a mensagem publicada chega na fila e sai quando consumida', async () => {
        const recebida: unknown[] = []

        await channel.consume(
            CADASTRO_ENRIQUECIMENTO_QUEUE,
            (msg: ConsumeMessage | null) => {
                if (msg) {
                    recebida.push(JSON.parse(msg.content.toString()))
                    channel.ack(msg)
                }
            },
            { noAck: false },
        )

        await firstValueFrom(
            client.emit(CADASTRO_ENRIQUECIMENTO_ROUTING_KEY, {
                pacienteId: 'paciente-teste-fila',
                tentativa: 1,
            }),
        )
        await new Promise((r) => setTimeout(r, 300))

        expect(recebida).toHaveLength(1)

        expect(recebida[0]).toMatchObject({
            pattern: CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            data: { pacienteId: 'paciente-teste-fila', tentativa: 1 },
        })
    })
})
