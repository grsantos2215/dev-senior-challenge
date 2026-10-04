import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types'

import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/infra/database/prisma/prisma.service'

describe('POST /check-ins (e2e)', () => {
    let app: INestApplication<App>
    let prisma: PrismaService

    const pacientesCriados: string[] = []

    function cpfInvalido(): string {
        return String(Math.floor(Math.random() * 1e11)).padStart(11, '0')
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
        await prisma.checkin.deleteMany({
            where: { pacienteId: { in: pacientesCriados } },
        })
        await prisma.paciente.deleteMany({
            where: { id: { in: pacientesCriados } },
        })
        await app.close()
    })

    it('cria o check-in como AGUARDANDO e INDISPONIVEL', async () => {
        const cpf = cpfInvalido()

        const resposta = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf })
            .expect(200)

        const {
            id,
            status,
            statusAgendamento,
            pacienteId,
            enriquecimentoPendente,
        } = resposta.body

        expect(status).toBe('AGUARDANDO')
        expect(statusAgendamento).toBe('INDISPONIVEL')
        expect(resposta.body.especialidade).toBeNull()
        expect(resposta.body.medico).toBeNull()
        expect(resposta.body.horario).toBeNull()
        expect(enriquecimentoPendente).toBe(true)

        pacientesCriados.push(pacienteId)

        const persisted = await prisma.checkin.findUnique({ where: { id } })
        expect(persisted?.status).toBe('AGUARDANDO')
        expect(persisted?.statusAgendamento).toBe('INDISPONIVEL')
    })

    it('deriva a data de referência do dia de hoje', async () => {
        const cpf = cpfInvalido()

        const resposta = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf })
            .expect(200)

        pacientesCriados.push(resposta.body.pacienteId)

        const hoje = new Date()
        const esperado = new Date(
            Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()),
        )
            .toISOString()
            .slice(0, 10)

        expect(resposta.body.dataReferencia.slice(0, 10)).toBe(esperado)
    })

    it('responde 409 no segundo check-in aberto do mesmo dia', async () => {
        const cpf = cpfInvalido()

        const primeiro = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf })
            .expect(200)
        pacientesCriados.push(primeiro.body.pacienteId)

        const segundo = await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf })
            .expect(409)

        expect(segundo.body.message).toContain('Já existe check-in aberto')
        expect(segundo.body.pacienteId).toBe(primeiro.body.pacienteId)
        expect(segundo.body.dataReferencia).toBe(
            primeiro.body.dataReferencia.slice(0, 10),
        )
    })

    it('responde 400 para CPF malformado, sem tocar no banco', async () => {
        const antes = await prisma.checkin.count()

        await request(app.getHttpServer())
            .post('/check-ins')
            .send({ cpf: '123' })
            .expect(400)

        expect(await prisma.checkin.count()).toBe(antes)
    })

    it('responde 400 quando o CPF não vem no corpo', async () => {
        await request(app.getHttpServer())
            .post('/check-ins')
            .send({})
            .expect(400)
    })
})
