import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { App } from 'supertest/types'

import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/infra/database/prisma/prisma.service'

describe('rotas de check-in (e2e)', () => {
    let app: INestApplication<App>
    let prisma: PrismaService

    const pacienteIds: string[] = []
    const checkinIds: string[] = []

    function cpf(): string {
        return String(Math.floor(Math.random() * 1e11)).padStart(11, '0')
    }

    async function criaCheckIn(
        cpfInformado = cpf(),
    ): Promise<{ id: string; pacienteId: string; cpf: string }> {
        const resposta = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf: cpfInformado })
            .expect(200)

        checkinIds.push(resposta.body.id)
        pacienteIds.push(resposta.body.pacienteId)

        return {
            id: resposta.body.id,
            pacienteId: resposta.body.pacienteId,
            cpf: cpfInformado,
        }
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile()

        app = moduleFixture.createNestApplication()
        app.useGlobalPipes(new ValidationPipe({}))
        await app.init()

        prisma = app.get(PrismaService)
    })

    afterAll(async () => {
        if (prisma) {
            try { await prisma.outboxEvent.deleteMany({}) } catch {}
            try { await prisma.checkin.deleteMany({}) } catch {}
            try { await prisma.paciente.deleteMany({}) } catch {}
            try { await prisma.log.deleteMany({}) } catch {}
        }
        if (app) {
            try { await app.close() } catch {}
        }
    })

    describe('GET /check-ins', () => {
        it('lista os check-ins do paciente pelo cpf', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .get('/check-ins')
                .query({ cpf: criado.cpf })
                .expect(200)

            expect(resposta.body.pacienteId).toBe(criado.pacienteId)
            expect(resposta.body.checkins).toHaveLength(1)
            expect(resposta.body.checkins[0].id).toBe(criado.id)
            expect(resposta.body.checkins[0].status).toBe('AGUARDANDO')
        })

        it('lista vazio para paciente sem check-in', async () => {
            const cpfDoPaciente = cpf()

            const paciente = await request(app.getHttpServer())
                .post('/check-ins')
                .send({ cpf: cpfDoPaciente })
                .expect(200)

            checkinIds.push(paciente.body.id)
            pacienteIds.push(paciente.body.pacienteId)

            await prisma.outboxEvent.deleteMany({
                where: { checkinId: { in: checkinIds } },
            })
            await prisma.checkin.deleteMany({
                where: { id: paciente.body.id },
            })
            checkinIds.pop()

            const resposta = await request(app.getHttpServer())
                .get('/check-ins')
                .query({ cpf: cpfDoPaciente })
                .expect(200)

            expect(resposta.body.checkins).toEqual([])
        })

        it('distingue cpf desconhecido de paciente sem fila', async () => {
            await request(app.getHttpServer())
                .get('/check-ins')
                .query({ cpf: cpf() })
                .expect(404)
        })

        it('rejeita cpf malformado com 400', async () => {
            await request(app.getHttpServer())
                .get('/check-ins')
                .query({ cpf: '123' })
                .expect(400)
        })
    })

    describe('GET /check-ins/contagem', () => {
        it('conta os check-ins do paciente pelo cpf', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .get('/check-ins/contagem')
                .query({ cpf: criado.cpf })
                .expect(200)

            expect(resposta.body.pacienteId).toBe(criado.pacienteId)
            expect(resposta.body.count).toBe(1)
        })

        it('conta zero para paciente novo', async () => {
            const novo = await prisma.paciente.create({
                data: { cpf: cpf(), nome: null },
            })

            pacienteIds.push(novo.id)

            const resposta = await request(app.getHttpServer())
                .get('/check-ins/contagem')
                .query({ cpf: novo.cpf })
                .expect(200)

            expect(resposta.body.count).toBe(0)
        })
    })

    describe('GET /check-ins/:id', () => {
        it('devolve o check-in', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .get(`/check-ins/${criado.id}`)
                .expect(200)

            expect(resposta.body.id).toBe(criado.id)
            expect(resposta.body.status).toBe('AGUARDANDO')
        })

        it('devolve 404 para id desconhecido', async () => {
            await request(app.getHttpServer())
                .get('/check-ins/11111111-1111-4111-8111-111111111111')
                .expect(404)
        })

        it('devolve 400 para id que não é uuid', async () => {
            await request(app.getHttpServer())
                .get('/check-ins/nao-e-uuid')
                .expect(400)
        })
    })

    describe('POST /check-ins/:id/iniciar', () => {
        it('promove para EM_ATENDIMENTO', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            expect(resposta.body.status).toBe('EM_ATENDIMENTO')
            expect(resposta.body.eventoId).toBeTruthy()
        })

        it('é idempotente: repetir não devolve evento novo', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            const segunda = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            expect(segunda.body.status).toBe('EM_ATENDIMENTO')
            expect(segunda.body.eventoId).toBeNull()
        })

        it('devolve 404 para id desconhecido', async () => {
            await request(app.getHttpServer())
                .post('/check-ins/11111111-1111-4111-8111-111111111111/iniciar')
                .expect(404)
        })

        it('devolve 409 ao iniciar um check-in cancelado', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/cancelar`)
                .expect(200)

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(409)

            expect(resposta.body.message).toBeTruthy()
            expect(resposta.body.statusAtual).toBe('CANCELADO')
        })
    })

    describe('POST /check-ins/:id/finalizar', () => {
        it('promove para FINALIZADO', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/finalizar`)
                .expect(200)

            expect(resposta.body.status).toBe('FINALIZADO')
            expect(resposta.body.eventoId).toBeTruthy()
        })

        it('devolve 409 ao finalizar sem início', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/finalizar`)
                .expect(409)

            expect(resposta.body.message).toMatch(/sem início/)
            expect(resposta.body.statusAtual).toBe('AGUARDANDO')
        })
    })

    describe('POST /check-ins/:id/cancelar', () => {
        it('cancela a partir da triagem', async () => {
            const criado = await criaCheckIn()

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/cancelar`)
                .expect(200)

            expect(resposta.body.status).toBe('CANCELADO')
        })

        it('cancela a partir do atendimento', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            const resposta = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/cancelar`)
                .expect(200)

            expect(resposta.body.status).toBe('CANCELADO')
        })

        it('é idempotente', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/cancelar`)
                .expect(200)

            const segunda = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/cancelar`)
                .expect(200)

            expect(segunda.body.eventoId).toBeNull()
        })
    })

    describe('o ciclo completo pela HTTP', () => {
        it('cria, consulta, inicia e finaliza', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .get('/check-ins')
                .query({ cpf: criado.cpf })
                .expect(200)

            await request(app.getHttpServer())
                .get('/check-ins/contagem')
                .query({ cpf: criado.cpf })
                .expect(200)

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            const finalizado = await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/finalizar`)
                .expect(200)

            expect(finalizado.body.status).toBe('FINALIZADO')

            const consulta = await request(app.getHttpServer())
                .get(`/check-ins/${criado.id}`)
                .expect(200)

            expect(consulta.body.status).toBe('FINALIZADO')
        })
    })

    describe('a auditoria de cada rota', () => {
        it('um check-in criado pela HTTP gera CHECKIN_CRIADO e CHECKIN_STATUS_ALTERADO', async () => {
            const criado = await criaCheckIn()

            await request(app.getHttpServer())
                .post(`/check-ins/${criado.id}/iniciar`)
                .expect(200)

            const logs = await prisma.log.findMany({
                where: { checkinId: criado.id },
                orderBy: { criadoEm: 'asc' },
            })

            const acoes = logs.map((log) => log.acao)

            expect(acoes).toContain('CHECKIN_CRIADO')
            expect(acoes).toContain('CHECKIN_STATUS_ALTERADO')
        })
    })
})

