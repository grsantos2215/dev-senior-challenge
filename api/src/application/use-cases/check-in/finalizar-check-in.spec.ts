import {
    CheckinFinalizadoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { beforeEach, describe, expect, it } from 'vitest'

import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { FinalizarCheckIn } from './finalizar-check-in'

class FakeCheckInRepository implements CheckInRepository {
    public readonly salvos: CheckIn[] = []
    public falharNoSave = false

    private porId = new Map<string, CheckIn>()

    async create(checkIn: CheckIn): Promise<void> {
        this.porId.set(checkIn.id, checkIn)
        this.salvos.push(checkIn)
    }

    async findById(id: string): Promise<CheckIn | null> {
        return this.porId.get(id) ?? null
    }

    async findManyByPacienteId(): Promise<CheckIn[]> {
        return this.salvos
    }

    async countManyByPacienteId(): Promise<number> {
        return this.salvos.length
    }

    async save(checkIn: CheckIn): Promise<void> {
        if (this.falharNoSave) throw new Error('banco de dados fora')
        this.porId.set(checkIn.id, checkIn)
        this.salvos.push(checkIn)
    }

    agendar(checkIn: CheckIn): void {
        this.porId.set(checkIn.id, checkIn)
    }
}

class FakeEventos extends EventosDeCheckInPort {
    public readonly finalizados: CheckinFinalizadoEvent[] = []

    publicarCheckinCriado(): string {
        return 'evento-criado'
    }

    publicarCheckinIniciado(): string {
        return 'evento-iniciado'
    }

    publicarCheckinFinalizado(evento: CheckinFinalizadoEvent): string {
        this.finalizados.push(evento)
        return `evento-${this.finalizados.length}`
    }

    publicarCheckinCancelado(): string {
        return 'evento-cancelado'
    }
}

function checkInAgendado(): CheckIn {
    return new CheckIn({
        status: 'AGUARDANDO',
        statusAgendamento: 'INDISPONIVEL',
        dataReferencia: new Date(Date.UTC(2026, 9, 4)),
        pacienteId: 'paciente-1',
    })
}

function checkInEmAtendimento(): CheckIn {
    const checkIn = checkInAgendado()
    checkIn.iniciado()
    return checkIn
}

describe('FinalizarCheckIn', () => {
    let repo: FakeCheckInRepository
    let eventos: FakeEventos
    let sut: FinalizarCheckIn

    beforeEach(() => {
        repo = new FakeCheckInRepository()
        eventos = new FakeEventos()
        sut = new FinalizarCheckIn(repo, eventos)
    })

    it('promove EM_ATENDIMENTO para FINALIZADO', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)

        const { checkIn } = await sut.execute({ checkinId: existente.id })

        expect(checkIn.status).toBe('FINALIZADO')
        expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
    })

    it('persiste a mudança', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })

        expect(repo.salvos).toHaveLength(1)
        expect(repo.salvos[0].id).toBe(existente.id)
        expect((await repo.findById(existente.id))!.status).toBe('FINALIZADO')
    })

    it('publica checkin.finalizado com o status novo', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)

        const { eventoId } = await sut.execute({ checkinId: existente.id })

        expect(eventoId).toBe('evento-1')
        expect(eventos.finalizados).toEqual([
            {
                checkinId: existente.id,
                pacienteId: 'paciente-1',
                status: 'FINALIZADO',
            },
        ])
    })

    it('lança CheckInNotFound quando o check-in não existe', async () => {
        await expect(sut.execute({ checkinId: 'inexistente' })).rejects.toThrow(
            CheckInNotFound,
        )
    })

    it('não finaliza sem início, e não publica nada', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await expect(sut.execute({ checkinId: existente.id })).rejects.toThrow(
            /não pode ser finalizado sem início/,
        )

        expect(eventos.finalizados).toHaveLength(0)
        expect(repo.salvos).toHaveLength(0)
    })

    it('é idempotente: repetir não publica outro evento', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })
        const segunda = await sut.execute({ checkinId: existente.id })

        expect(segunda.eventoId).toBeNull()
        expect(eventos.finalizados).toHaveLength(1)
    })

    it('não publica quando o save falha', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)
        repo.falharNoSave = true

        await expect(
            sut.execute({ checkinId: existente.id }),
        ).rejects.toThrow('banco de dados fora')

        expect(eventos.finalizados).toHaveLength(0)
    })
})