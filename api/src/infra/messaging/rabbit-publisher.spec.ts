import { Controller, INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EventPattern, Transport } from '@nestjs/microservices'
import { Test } from '@nestjs/testing'
import amqp, { type Channel, type GetMessage } from 'amqplib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { RabbitPublisher } from './rabbit-publisher'
import { CHECKIN_EXCHANGE } from './rabbit-mq/fila'

const BROKER_URL = process.env.BROKER_URL ?? 'amqp://localhost:5672'
const MANAGEMENT_URL =
    process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15672'
const ROUTING_KEY = 'teste.publisher.compat'

const config = {
    getOrThrow: () => BROKER_URL,
} as unknown as ConfigService

function autenticacao(): string {
    return `Basic ${Buffer.from(
        `${process.env.RABBITMQ_USER ?? 'guest'}:${process.env.RABBITMQ_PASSWORD ?? 'guest'}`,
    ).toString('base64')}`
}

function corpoDa(mensagem: GetMessage | false): unknown {
    if (mensagem === false) throw new Error('nenhuma mensagem recebida')

    return JSON.parse(mensagem.content.toString())
}

function persistenciaDe(mensagem: GetMessage | false): number | undefined {
    if (mensagem === false) throw new Error('nenhuma mensagem recebida')

    return mensagem.properties.deliveryMode
}

async function estadoDaFila(
    fila: string,
): Promise<{ messages: number; messages_unacknowledged: number }> {
    const resposta = await fetch(
        `${MANAGEMENT_URL}/api/queues/%2F/${encodeURIComponent(fila)}`,
        { headers: { authorization: autenticacao() } },
    )

    return resposta.json()
}

describe('RabbitPublisher -> consumidor Nest', () => {
    const recebidos: Array<Record<string, unknown>> = []

    let app: INestApplication
    let publisher: RabbitPublisher
    let conexao: Awaited<ReturnType<typeof amqp.connect>>
    let inspecao: Channel
    let filaInspecao: string
    let filaServidor: string

    @Controller()
    class ConsumidorTeste {
        @EventPattern(ROUTING_KEY)
        async receber(payload: unknown): Promise<void> {
            recebidos.push(payload as Record<string, unknown>)
        }
    }

    beforeAll(async () => {
        filaInspecao = `publisher.compat.inspecao.${Date.now()}`
        filaServidor = `publisher.compat.servidor.${Date.now()}`

        const moduleFixture = await Test.createTestingModule({
            controllers: [ConsumidorTeste],
        }).compile()

        app = moduleFixture.createNestApplication()
        app.connectMicroservice({
            transport: Transport.RMQ,
            options: {
                urls: [BROKER_URL],
                exchange: CHECKIN_EXCHANGE,
                queue: filaServidor,
                wildcards: true,
            },
        })
        await app.startAllMicroservices()

        publisher = new RabbitPublisher(config)
        await publisher.onModuleInit()

        conexao = await amqp.connect(BROKER_URL)
        inspecao = await conexao.createChannel()
        await inspecao.assertQueue(filaInspecao, { durable: false })
        await inspecao.bindQueue(filaInspecao, CHECKIN_EXCHANGE, ROUTING_KEY)
    }, 60_000)

    afterAll(async () => {
        await app.close()
        await publisher.onModuleDestroy()

        await inspecao.deleteQueue(filaInspecao)
        await inspecao.deleteQueue(filaServidor).catch(() => undefined)
        await inspecao.close()
        await conexao.close()
    })

    async function aguardarEntrega(marcador: string): Promise<unknown> {
        let entrega: Record<string, unknown> | undefined

        await vi.waitFor(
            () => {
                entrega = recebidos.find(
                    (payload) => payload.marcador === marcador,
                )
                expect(entrega).toBeDefined()
            },
            { timeout: 10000, interval: 100 },
        )

        return entrega
    }

    it('publica o envelope { pattern, data } e nenhum id', async () => {
        await publisher.publicar(ROUTING_KEY, {
            pacienteId: 'p-1',
            tentativa: 1,
        })

        let recebida: GetMessage | false = false
        await vi.waitFor(
            async () => {
                recebida = await inspecao.get(filaInspecao, { noAck: true })
                expect(recebida).not.toBe(false)
            },
            { timeout: 5000, interval: 100 },
        )

        if (recebida === false) throw new Error('mensagem ausente')
        const corpo = corpoDa(recebida) as Record<string, unknown>

        expect(corpo.pattern).toBe(ROUTING_KEY)
        expect(corpo.data).toEqual({ pacienteId: 'p-1', tentativa: 1 })
        expect(corpo).not.toHaveProperty('id')
        expect(persistenciaDe(recebida)).toBe(2)
    })

    it('entrega a payload no handler, em vez de nack para a DLQ', async () => {
        await publisher.publicar(ROUTING_KEY, { marcador: 'entrega' })

        expect(await aguardarEntrega('entrega')).toEqual({
            marcador: 'entrega',
        })
    })

    it('confirma a entrega: a fila esvazia depois do handler', async () => {
        await publisher.publicar(ROUTING_KEY, { marcador: 'confirma' })

        expect(await aguardarEntrega('confirma')).toEqual({
            marcador: 'confirma',
        })

        await vi.waitFor(
            async () => {
                const depois = await estadoDaFila(filaServidor)
                expect(depois.messages_unacknowledged).toBe(0)
            },
            { timeout: 10000, interval: 250 },
        )
    })

    it('nao lanca quando o canal sumiu', async () => {
        const quebrado = new RabbitPublisher(config)
        await quebrado.onModuleDestroy()

        await expect(
            quebrado.publicar(ROUTING_KEY, { qualquer: true }),
        ).resolves.toBeUndefined()
    })
})