/**
 * Prova de que a topologia de enriquecimento existe, esta duravel e roteia.
 *
 * Fala com o broker de verdade: mock nenhum prova retencao, ja que o defeito
 * era justamente a fila nao existir. Sem fila declarada o broker aceita a
 * publicacao e descarta a mensagem, e o unico sintoma visivel e um paciente que
 * nunca ganha nome.
 *
 * Exige o broker em `BROKER_URL` e a API de gerenciamento em
 * `RABBITMQ_MANAGEMENT_URL` (padrao `http://localhost:15672`, guest/guest).
 */
import amqp, { type ConfirmChannel, type ConsumeMessage } from 'amqplib'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
    CADASTRO_ENRIQUECIMENTO_DLQ_ROUTING_KEY,
    CADASTRO_ENRIQUECIMENTO_QUEUE,
    CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    CHECKIN_EXCHANGE,
    declararTopologiaEnriquecimento,
} from './fila'

const MANAGEMENT_URL =
    process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15672'

const EXCHANGE_TESTE = 'checkin.events.teste'

async function consultarApi(caminho: string): Promise<any> {
    const resposta = await fetch(`${MANAGEMENT_URL}${caminho}`, {
        headers: {
            authorization: `Basic ${Buffer.from(
                `${process.env.RABBITMQ_USER ?? 'guest'}:${process.env.RABBITMQ_PASSWORD ?? 'guest'}`,
            ).toString('base64')}`,
        },
    })

    if (!resposta.ok) {
        throw new Error(
            `API de gerenciamento do RabbitMQ respondeu ${resposta.status} em ${caminho}. ` +
                `O painel precisa estar exposto para esta suite.`,
        )
    }

    return resposta.json()
}

describe('topologia de enriquecimento', () => {
    let conexao: Awaited<ReturnType<typeof amqp.connect>>
    let channel: ConfirmChannel

    beforeAll(async () => {
        conexao = await amqp.connect(
            process.env.BROKER_URL ?? 'amqp://localhost:5672',
        )
        channel = await conexao.createConfirmChannel()
        await channel.assertExchange(EXCHANGE_TESTE, 'topic', {
            durable: false,
        })
    })

    afterAll(async () => {
        await channel.deleteExchange(EXCHANGE_TESTE)
        await channel.close()
        await conexao.close()
    })

    it('a declaração é idempotente (sobe duas vezes sem erro)', async () => {
        await declararTopologiaEnriquecimento(channel)
        await expect(
            declararTopologiaEnriquecimento(channel),
        ).resolves.toBeUndefined()
    })

    it('a fila de produção está ligada ao exchange com a routing key certa', async () => {
        const bindings = await consultarApi(
            `/api/bindings/%2F/e/${CHECKIN_EXCHANGE}/q/${CADASTRO_ENRIQUECIMENTO_QUEUE}`,
        )

        expect(
            bindings.some(
                (b: { routing_key: string }) =>
                    b.routing_key === CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            ),
        ).toBe(true)
    })

    it('a fila e durável e manda para a DLQ no reject', async () => {
        const fila = await consultarApi(
            `/api/queues/%2F/${CADASTRO_ENRIQUECIMENTO_QUEUE}`,
        )

        expect(fila.durable).toBe(true)
        expect(fila.auto_delete).toBe(false)
        expect(fila.arguments['x-dead-letter-exchange']).toBe(CHECKIN_EXCHANGE)
        expect(fila.arguments['x-dead-letter-routing-key']).toBe(
            CADASTRO_ENRIQUECIMENTO_DLQ_ROUTING_KEY,
        )
    })

    it('a mensagem publicada chega na fila e sai quando consumida', async () => {
        const fila = `cadastro.enriquecer.teste.${randomUUID()}`

        await channel.assertQueue(fila, {
            durable: false,
            exclusive: true,
            autoDelete: true,
        })
        await channel.bindQueue(
            fila,
            EXCHANGE_TESTE,
            CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
        )

        const recebida: unknown[] = []

        await channel.consume(
            fila,
            (msg: ConsumeMessage | null) => {
                if (msg) {
                    recebida.push(JSON.parse(msg.content.toString()))
                    channel.ack(msg)
                }
            },
            { noAck: false },
        )

        channel.publish(
            EXCHANGE_TESTE,
            CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            Buffer.from(
                JSON.stringify({
                    pattern: CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
                    data: { pacienteId: 'paciente-teste-fila', tentativa: 1 },
                }),
            ),
            { persistent: true },
        )
        await channel.waitForConfirms()

        await new Promise((r) => setTimeout(r, 300))

        await channel.deleteQueue(fila)

        expect(recebida).toHaveLength(1)
        expect(recebida[0]).toMatchObject({
            pattern: CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
            data: { pacienteId: 'paciente-teste-fila', tentativa: 1 },
        })
    })

    it('sem o binding a mensagem se perde em silêncio', async () => {
        const exchange = EXCHANGE_TESTE
        const fila = `cadastro.enriquecer.sem-binding.${randomUUID()}`

        const routingKeySemBinding = `${CADASTRO_ENRIQUECIMENTO_ROUTING_KEY}.sem-binding`

        await channel.assertQueue(fila, {
            durable: false,
            exclusive: true,
            autoDelete: true,
        })

        const recebida: unknown[] = []

        await channel.consume(
            fila,
            (msg: ConsumeMessage | null) => {
                if (msg) {
                    recebida.push(JSON.parse(msg.content.toString()))
                    channel.ack(msg)
                }
            },
            { noAck: false },
        )

        channel.publish(
            exchange,
            routingKeySemBinding,
            Buffer.from(
                JSON.stringify({
                    data: { pacienteId: 'paciente-sem-binding' },
                }),
            ),
            { persistent: true },
        )
        await channel.waitForConfirms()
        await new Promise((r) => setTimeout(r, 300))

        await channel.deleteQueue(fila)

        expect(recebida).toHaveLength(0)
    })
})
