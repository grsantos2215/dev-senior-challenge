import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { App } from 'supertest/types'

import { AppModule } from '../src/app.module'
import { RabbitPublisher } from '../src/infra/messaging/rabbit-publisher'

/**
 * O `/health` é o contrato que o orquestrador usa para decidir se a instância
 * entra ou sai de rota, então o que está em teste é o código de status, não o
 * corpo. Um `200` com dependência caída é pior que nenhum endpoint: passa
 * traffic para uma instância que não consegue atender.
 */
describe('GET /health (e2e)', () => {
    let app: INestApplication<App>
    let moduleFixture: TestingModule

    beforeAll(async () => {
        moduleFixture = await Test.createTestingModule({
            imports: [AppModule],
        }).compile()

        app = moduleFixture.createNestApplication()
        await app.init()
    })

    afterAll(async () => {
        if (app) {
            try { await app.close() } catch {}
        }
    })

    it('responde 200 com Postgres e broker de pé', async () => {
        const resposta = await request(app.getHttpServer())
            .get('/health')
            .expect(200)

        expect(resposta.body.status).toBe('ok')
        expect(resposta.body.dependencias).toBeDefined()
    })

    it('nomeia as dependências e diz o que cada uma respondeu', async () => {
        const resposta = await request(app.getHttpServer())
            .get('/health')
            .expect(200)

        const nomes = resposta.body.dependencias.map(
            (d: { nome: string }) => d.nome,
        )

        // Nome explícito importa: log de health sem chave é log que ninguém lê.
        expect(nomes).toContain('postgres')
        expect(nomes).toContain('rabbitmq')
    })

    it('responde 503 e status degradado quando o broker cai', async () => {
        // Sobrepõe o RabbitPublisher, não a lista de checagens: assim o
        // ChecagemDoBroker continua a ser o código real sob teste, e o que muda
        // é só a resposta do broker. Overrides de token de string
        // (CHEGAGADAS_DE_DEPENDENCIA) não são aplicados de forma fiável aqui.
        const moduleDegradado = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(RabbitPublisher)
            .useValue({ estaConectado: () => false })
            .compile()

        const appDegradado = moduleDegradado.createNestApplication()
        await appDegradado.init()

        try {
            const resposta = await request(appDegradado.getHttpServer())
                .get('/health')
                .expect(503)

            expect(resposta.body.status).toBe('degradado')

            const rabbit = resposta.body.dependencias.find(
                (d: { nome: string }) => d.nome === 'rabbitmq',
            )
            expect(rabbit.saudavel).toBe(false)

            // Postgres real continua de pé: o endpoint distingue qual caiu.
            const postgres = resposta.body.dependencias.find(
                (d: { nome: string }) => d.nome === 'postgres',
            )
            expect(postgres.saudavel).toBe(true)
        } finally {
            await appDegradado.close()
        }
    })
})