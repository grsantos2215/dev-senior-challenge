import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { App } from 'supertest/types'

import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/infra/database/prisma/prisma.service'

describe('logs append-only (e2e)', () => {
    let app: INestApplication<App>
    let prisma: PrismaService

    const checkinIds: string[] = []
    const pacienteIds: string[] = []

    function cpfInvalido(): string {
        return String(Math.floor(Math.random() * 1e11)).padStart(11, '0')
    }

    async function criaCheckIn(): Promise<{
        id: string
        pacienteId: string
    }> {
        const resposta = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf: cpfInvalido() })
            .expect(200)

        checkinIds.push(resposta.body.id)
        pacienteIds.push(resposta.body.pacienteId)

        return { id: resposta.body.id, pacienteId: resposta.body.pacienteId }
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile()

        app = moduleFixture.createNestApplication()
        await app.init()

        prisma = app.get(PrismaService)
    })

    afterAll(async () => {
        await prisma.checkin.deleteMany({
            where: { id: { in: checkinIds } },
        })
        await prisma.paciente.deleteMany({
            where: { id: { in: pacienteIds } },
        })
        await app.close()
    })

    describe('o que a aplicação escreve', () => {
        it('cria CHECKIN_CRIADO ligado ao check-in', async () => {
            const { id, pacienteId } = await criaCheckIn()

            const logs = await prisma.log.findMany({
                where: { checkinId: id },
                orderBy: { criadoEm: 'asc' },
            })

            expect(logs.length).toBeGreaterThanOrEqual(1)
            expect(logs[0].acao).toBe('CHECKIN_CRIADO')
            expect(logs[0].pacienteId).toBe(pacienteId)
            expect(logs[0].contexto).toMatchObject({ status: 'AGUARDANDO' })
        })

        it('não escreve cpf nem nome no contexto', async () => {
            const { id } = await criaCheckIn()

            const logs = await prisma.log.findMany({ where: { checkinId: id } })
            const serializado = JSON.stringify(logs.map((log) => log.contexto))

            expect(serializado).not.toMatch(/\d{11}/)
            expect(serializado.toLowerCase()).not.toContain('nome')
        })

        it('não tem coluna de mensagem em texto livre', async () => {
            const colunas = await prisma.$queryRawUnsafe<
                { column_name: string }[]
            >(`SELECT column_name FROM information_schema.columns
                WHERE table_name = 'logs'`)

            const nomes = colunas.map((coluna) => coluna.column_name)

            expect(nomes).not.toContain('mensagem')
            expect(nomes).toContain('acao')
            expect(nomes).toContain('contexto')
        })
    })

    describe('o que o banco recusa', () => {
        it('recusa UPDATE num log', async () => {
            const { id } = await criaCheckIn()

            const log = await prisma.log.findFirst({ where: { checkinId: id } })

            await expect(
                prisma.log.update({
                    where: { id: log!.id },
                    data: { acao: 'INTEGRACAO_FALHOU' },
                }),
            ).rejects.toThrow(/logs sao append-only/)
        })

        it('recusa DELETE num log', async () => {
            const { id } = await criaCheckIn()

            const log = await prisma.log.findFirst({ where: { checkinId: id } })

            await expect(
                prisma.log.delete({ where: { id: log!.id } }),
            ).rejects.toThrow(/logs sao append-only/)
        })

        it('o registro recusado continua lá', async () => {
            const { id } = await criaCheckIn()

            const antes = await prisma.log.findFirst({
                where: { checkinId: id },
            })

            await prisma.log
                .update({
                    where: { id: antes!.id },
                    data: { acao: 'INTEGRACAO_FALHOU' },
                })
                .catch(() => undefined)

            const depois = await prisma.log.findFirst({
                where: { checkinId: id },
            })

            expect(depois!.acao).toBe(antes!.acao)
            expect(depois!.contexto).toEqual(antes!.contexto)
        })
    })
})
