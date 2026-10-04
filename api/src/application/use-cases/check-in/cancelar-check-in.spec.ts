import {
    CheckinCanceladoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { beforeEach, describe, expect, it } from 'vitest'

import { CancelarCheckIn } from './cancelar-check-in'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'

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
    public readonly cancelados: CheckinCanceladoEvent[] = []

    publicarCheckinCriado(): string {
        return 'evento-criado'
    }

    publicarCheckinIniciado(): string {
        return 'evento-iniciado'
    }

    publicarCheckinFinalizado(): string {
        return 'evento-finalizado'
    }

    publicarCheckinCancelado(evento: CheckinCanceladoEvent): string {
        this.cancelados.push(evento)
        return `evento-${this.cancelados.length}`
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

describe('CancelarCheckIn', () => {
    let repo: FakeCheckInRepository
    let eventos: FakeEventos
    let sut: CancelarCheckIn

    beforeEach(() => {
        repo = new FakeCheckInRepository()
        eventos = new FakeEventos()
        sut = new CancelarCheckIn(repo, eventos)
    })

    it('cancela um check-in que ainda está na triagem', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        const { checkIn } = await sut.execute({ checkinId: existente.id })

        expect(checkIn.status).toBe('CANCELADO')
        expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
    })

    it('cancela um check-in que já estava em atendimento', async () => {
        const existente = checkInEmAtendimento()
        repo.agendar(existente)

        const { checkIn } = await sut.execute({ checkinId: existente.id })

        expect(checkIn.status).toBe('CANCELADO')
    })

    it('persiste a mudança', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })

        expect(repo.salvos).toHaveLength(1)
        expect((await repo.findById(existente.id))!.status).toBe('CANCELADO')
    })

    it('publica checkin.cancelado com o status novo', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        const { eventoId } = await sut.execute({ checkinId: existente.id })

        expect(eventoId).toBe('evento-1')
        expect(eventos.cancelados).toEqual([
            {
                checkinId: existente.id,
                pacienteId: 'paciente-1',
                status: 'CANCELADO',
            },
        ])
    })

    it('lança CheckInNotFound quando o check-in não existe', async () => {
        await expect(sut.execute({ checkinId: 'inexistente' })).rejects.toThrow(
            CheckInNotFound,
        )
    })

    it('não mexe num check-in já finalizado', async () => {
        const existente = checkInEmAtendimento()
        existente.finalizado()
        repo.agendar(existente)

        const { checkIn, eventoId } = await sut.execute({
            checkinId: existente.id,
        })

        expect(checkIn.status).toBe('FINALIZADO')
        expect(eventoId).toBeNull()
        expect(eventos.cancelados).toHaveLength(0)
    })

    it('é idempotente: repetir não publica outro evento', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })
        const segunda = await sut.execute({ checkinId: existente.id })

        expect(segunda.eventoId).toBeNull()
        expect(eventos.cancelados).toHaveLength(1)
    })

    it('não publica quando o save falha', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)
        repo.falharNoSave = true

        await expect(
            sut.execute({ checkinId: existente.id }),
        ).rejects.toThrow('banco de dados fora')

        expect(eventos.cancelados).toHaveLength(0)
    })
})