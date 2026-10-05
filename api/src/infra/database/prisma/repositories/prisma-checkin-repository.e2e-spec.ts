import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CheckIn } from '@/application/entities/checkin'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import type { ConfigService } from '@nestjs/config'
import { PrismaCheckInRepository } from './prisma-checkin-repository'
import { PrismaService } from '../prisma.service'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const url =
    process.env.DATABASE_URL ??
    (() => {
        const match = /DATABASE_URL="?([^"\r\n]+)"?/.exec(
            readFileSync('.env', 'utf8'),
        )

        if (!match)
            throw new Error(
                'DATABASE_URL não encontrada no ambiente nem em .env',
            )
        return match[1]
    })()

const config = {
    getOrThrow: () => url,
} as unknown as ConfigService

const prisma = new PrismaService(config)
const repo = new PrismaCheckInRepository(prisma)

const pacientesCriados: string[] = []

async function criarPaciente(): Promise<string> {
    const id = randomUUID()
    pacientesCriados.push(id)

    await prisma.paciente.create({
        data: {
            id,
            nome: 'Paciente de Teste',
            cpf: String(Math.floor(Math.random() * 1e11)).padStart(11, '0'),
            dataNascimento: new Date('1990-01-01T00:00:00Z'),
        },
    })

    return id
}

function novoCheckIn(
    pacienteId: string,
    extra: Partial<ConstructorParameters<typeof CheckIn>[0]> = {},
): CheckIn {
    return new CheckIn({
        status: 'AGUARDANDO',
        dataReferencia: new Date('2026-10-03T00:00:00Z'),
        pacienteId,
        statusAgendamento: 'AUSENTE',
        ...extra,
    })
}

describe('PrismaCheckInRepository (banco real)', () => {
    beforeAll(async () => {
        await prisma.onModuleInit()
    })

    afterAll(async () => {
        const checkins = await prisma.checkin.findMany({
            where: { pacienteId: { in: pacientesCriados } },
            select: { id: true },
        })
        const checkinIds = checkins.map((c) => c.id)
        await prisma.outboxEvent.deleteMany({
            where: { checkinId: { in: checkinIds } },
        })
        await prisma.checkin.deleteMany({
            where: { pacienteId: { in: pacientesCriados } },
        })
        await prisma.paciente.deleteMany({
            where: { id: { in: pacientesCriados } },
        })
        await prisma.onModuleDestroy()
    })

    describe('horario', () => {
        it('grava a hora de parede, não a convertida', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                horario: '09:30',
            })

            await repo.create(checkIn)

            const [row] = await prisma.$queryRaw<{ h: string }[]>`
                SELECT to_char(horario, 'HH24:MI') AS h
                FROM checkins WHERE id = ${checkIn.id}::uuid`

            expect(row.h).toBe('09:30')
        })

        it('preserva minutos, e nao so a hora', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                horario: '14:05',
            })

            await repo.create(checkIn)

            const [row] = await prisma.$queryRaw<{ h: string }[]>`
                SELECT to_char(horario, 'HH24:MI') AS h
                FROM checkins WHERE id = ${checkIn.id}::uuid`

            expect(row.h).toBe('14:05')
        })

        it('relê o mesmo texto que foi gravado', async () => {
            const pacienteId = await criarPaciente()
            await repo.create(
                novoCheckIn(pacienteId, {
                    statusAgendamento: 'PRESENTE',
                    especialidade: 'Cardiologia',
                    horario: '09:30',
                }),
            )

            const lido = await repo.findById(await thisId(pacienteId, 0))

            expect(lido?.horario).toBe('09:30')
        })

        it('guarda null quando não há horário', async () => {
            const pacienteId = await criarPaciente()
            await repo.create(novoCheckIn(pacienteId))

            const lido = await repo.findById(await thisId(pacienteId, 0))

            expect(lido?.horario).toBeNull()
        })

        it('recusa horário malformado antes de tocar no banco', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId)
            checkIn.horario = '9h30'

            await expect(repo.create(checkIn)).rejects.toThrow(
                /horario invalido/,
            )

            expect(await repo.countManyByPacienteId(pacienteId)).toBe(0)
        })
    })

    describe('medico', () => {
        it('sobrevive ao round-trip', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                horario: '09:30',
            })
            checkIn.medico = 'Dra. Alcantara'

            await repo.create(checkIn)
            const lido = await repo.findById(checkIn.id)

            expect(lido?.medico).toBe('Dra. Alcantara')
        })
    })

    describe('findById', () => {
        it('devolve null para id inexistente', async () => {
            expect(await repo.findById(randomUUID())).toBeNull()
        })

        it('preserva o id do banco', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId)
            await repo.create(checkIn)

            expect((await repo.findById(checkIn.id))?.id).toBe(checkIn.id)
        })

        it('hidrata check-in com todos os campos', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                horario: '09:30',
            })
            checkIn.medico = 'Dr. Nina'
            await repo.create(checkIn)

            const lido = (await repo.findById(checkIn.id))!

            expect(lido.status).toBe('AGUARDANDO')
            expect(lido.statusAgendamento).toBe('PRESENTE')
            expect(lido.especialidade).toBe('Cardiologia')
            expect(lido.medico).toBe('Dr. Nina')
            expect(lido.horario).toBe('09:30')
            expect(lido.iniciadoEm).toBeNull()
            expect(lido.criadoEm).toBeInstanceOf(Date)
        })
    })

    describe('create', () => {
        it('persiste um check-in novo', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId)

            await repo.create(checkIn)

            expect((await repo.findById(checkIn.id))?.id).toBe(checkIn.id)
        })

        it('levanta quando o paciente tem check-in aberto no mesmo dia', async () => {
            const pacienteId = await criarPaciente()
            await repo.create(novoCheckIn(pacienteId))

            await expect(repo.create(novoCheckIn(pacienteId))).rejects.toThrow()
        })

        it('aceita segundo check-in depois de finalizar o primeiro', async () => {
            const pacienteId = await criarPaciente()
            const primeiro = novoCheckIn(pacienteId)
            await repo.create(primeiro)
            primeiro.iniciado()
            primeiro.finalizado()
            await repo.save(primeiro)

            await expect(
                repo.create(novoCheckIn(pacienteId)),
            ).resolves.toBeUndefined()
        })
    })

    describe('save', () => {
        it('persiste a mudança de status', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId)
            await repo.create(checkIn)

            checkIn.iniciado()
            await repo.save(checkIn)

            const lido = (await repo.findById(checkIn.id))!
            expect(lido.status).toBe('EM_ATENDIMENTO')
            expect(lido.iniciadoEm).toBeInstanceOf(Date)
        })

        it('preserva a hora de parede depois de um save', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                horario: '09:30',
            })
            await repo.create(checkIn)

            checkIn.medico = 'Dr. Nina'
            await repo.save(checkIn)

            const [row] = await prisma.$queryRaw<{ h: string }[]>`
                SELECT to_char(horario, 'HH24:MI') AS h
                FROM checkins WHERE id = ${checkIn.id}::uuid`

            expect(row.h).toBe('09:30')
        })

        it('nao faz nada se a linha nao existir, em vez de estourar', async () => {
            const checkIn = novoCheckIn(await criarPaciente())

            await expect(repo.save(checkIn)).resolves.toBeUndefined()
        })
    })

    describe('findManyByPacienteId', () => {
        it('devolve só os check-ins do paciente', async () => {
            const meu = await criarPaciente()
            const outro = await criarPaciente()
            await repo.create(novoCheckIn(meu))
            await repo.create(novoCheckIn(outro))

            const meus = await repo.findManyByPacienteId(meu)

            expect(meus).toHaveLength(1)
            expect(meus[0].pacienteId).toBe(meu)
        })

        it('ordena do mais recente para o mais antigo', async () => {
            const pacienteId = await criarPaciente()
            await repo.create(
                novoCheckIn(pacienteId, {
                    dataReferencia: new Date('2026-10-01T00:00:00Z'),
                    criadoEm: new Date('2026-10-01T09:00:00Z'),
                }),
            )
            await repo.create(
                novoCheckIn(pacienteId, {
                    dataReferencia: new Date('2026-10-02T00:00:00Z'),
                    criadoEm: new Date('2026-10-02T09:00:00Z'),
                }),
            )

            const meus = await repo.findManyByPacienteId(pacienteId)

            expect(meus.map((c) => c.dataReferencia.toISOString())).toEqual([
                '2026-10-02T00:00:00.000Z',
                '2026-10-01T00:00:00.000Z',
            ])
        })

        it('devolve vazio para paciente sem check-in', async () => {
            expect(await repo.findManyByPacienteId(randomUUID())).toEqual([])
        })
    })

    describe('countManyByPacienteId', () => {
        it('conta os check-ins do paciente', async () => {
            const pacienteId = await criarPaciente()
            const outro = await criarPaciente()
            await repo.create(
                novoCheckIn(pacienteId, {
                    dataReferencia: new Date('2026-10-01T00:00:00Z'),
                }),
            )
            await repo.create(
                novoCheckIn(pacienteId, {
                    dataReferencia: new Date('2026-10-02T00:00:00Z'),
                }),
            )
            await repo.create(novoCheckIn(outro))

            expect(await repo.countManyByPacienteId(pacienteId)).toBe(2)
        })

        it('conta zero para paciente desconhecido', async () => {
            expect(await repo.countManyByPacienteId(randomUUID())).toBe(0)
        })
    })

    describe('dataReferencia', () => {
        it('grava o dia da data, e não o instante', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                dataReferencia: new Date('2026-10-04T12:00:00Z'),
            })

            await repo.create(checkIn)

            const [row] = await prisma.$queryRaw<{ d: string }[]>`
                SELECT to_char(data_referencia, 'YYYY-MM-DD') AS d
                FROM checkins WHERE id = ${checkIn.id}::uuid`

            expect(row.d).toBe('2026-10-04')
        })

        it('devolve o dia como meia-noite UTC', async () => {
            const pacienteId = await criarPaciente()
            const checkIn = novoCheckIn(pacienteId, {
                dataReferencia: new Date('2026-10-04T12:00:00Z'),
            })

            await repo.create(checkIn)

            const lido = await repo.findById(checkIn.id)

            expect(lido!.dataReferencia.toISOString()).toBe(
                '2026-10-04T00:00:00.000Z',
            )
        })
    })

    describe('check-in ja aberto', () => {
        it('rejeita o segundo check-in aberto do mesmo dia', async () => {
            const pacienteId = await criarPaciente()
            await repo.create(novoCheckIn(pacienteId))

            await expect(repo.create(novoCheckIn(pacienteId))).rejects.toThrow(
                'Já existe check-in aberto',
            )
        })

        it('traduz o P2002 em CheckInJaAberto, com o paciente e a data', async () => {
            const pacienteId = await criarPaciente()
            const dia = new Date('2026-10-05T00:00:00Z')
            await repo.create(novoCheckIn(pacienteId, { dataReferencia: dia }))

            const erro = await repo
                .create(novoCheckIn(pacienteId, { dataReferencia: dia }))
                .then(() => null)
                .catch((e: unknown) => e)

            expect(erro).toBeInstanceOf(CheckInJaAberto)
            expect((erro as CheckInJaAberto).pacienteId).toBe(pacienteId)
            expect((erro as CheckInJaAberto).dataReferencia).toEqual(dia)
        })

        it('aceita um segundo check-in no mesmo dia se o primeiro fechou', async () => {
            const pacienteId = await criarPaciente()
            const primeiro = novoCheckIn(pacienteId)
            await repo.create(primeiro)

            primeiro.iniciado()
            primeiro.finalizado()
            await repo.save(primeiro)

            await expect(
                repo.create(novoCheckIn(pacienteId)),
            ).resolves.toBeUndefined()
            expect(await repo.countManyByPacienteId(pacienteId)).toBe(2)
        })

        it('aceita check-ins no mesmo dia para pacientes diferentes', async () => {
            const a = await criarPaciente()
            const b = await criarPaciente()

            await repo.create(novoCheckIn(a))
            await repo.create(novoCheckIn(b))

            expect(await repo.countManyByPacienteId(a)).toBe(1)
            expect(await repo.countManyByPacienteId(b)).toBe(1)
        })
    })
})

async function thisId(pacienteId: string, indice: number): Promise<string> {
    const [row] = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM checkins
        WHERE paciente_id = ${pacienteId}::uuid
        ORDER BY criado_em ASC
        LIMIT 1 OFFSET ${indice}`

    return row.id
}
