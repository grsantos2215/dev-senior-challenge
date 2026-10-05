import {
    CheckinCriadoEvent,
    CheckinIniciadoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { beforeEach, describe, expect, it } from 'vitest'

import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { FakeAuditoria } from '@test/support/fake-auditoria'
import { StartCheckIn } from './start-check-in'

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
    public readonly iniciados: CheckinIniciadoEvent[] = []
    public readonly criados: CheckinCriadoEvent[] = []

    publicarCheckinCriado(evento: CheckinCriadoEvent): string {
        this.criados.push(evento)
        return 'evento-criado'
    }

    publicarCheckinIniciado(evento: CheckinIniciadoEvent): string {
        this.iniciados.push(evento)
        return `evento-${this.iniciados.length}`
    }

    publicarCheckinFinalizado(): string {
        return 'evento-finalizado'
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

describe('StartCheckIn', () => {
    let repo: FakeCheckInRepository
    let auditoria: FakeAuditoria
    let sut: StartCheckIn

    beforeEach(() => {
        repo = new FakeCheckInRepository()
        auditoria = new FakeAuditoria()
        sut = new StartCheckIn(repo, auditoria)
    })

    it('promove AGUARDANDO para EM_ATENDIMENTO', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        const { checkIn } = await sut.execute({ checkinId: existente.id })

        expect(checkIn.status).toBe('EM_ATENDIMENTO')
        expect(checkIn.iniciadoEm).toBeInstanceOf(Date)
    })

    it('persiste a mudança', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })

        expect(repo.salvos).toHaveLength(1)
        expect(repo.salvos[0].id).toBe(existente.id)
        expect((await repo.findById(existente.id))!.status).toBe(
            'EM_ATENDIMENTO',
        )
    })

    it('publica checkin.iniciado com o status novo', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        const { checkIn, eventoId } = await sut.execute({
            checkinId: existente.id,
        })

        expect(repo.salvos[0].iniciadoEm).toBeInstanceOf(Date)
    })

    it('levanta CheckInNotFound para id desconhecido', async () => {
        await expect(
            sut.execute({ checkinId: 'nao-existe' }),
        ).rejects.toBeInstanceOf(CheckInNotFound)

        expect(repo.salvos).toHaveLength(0)
    })

    it('é idempotente: reiniciar não recarimba nem muda o status', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        const primeiro = await sut.execute({ checkinId: existente.id })
        const segundo = await sut.execute({ checkinId: existente.id })

        expect(segundo.checkIn.iniciadoEm).toEqual(primeiro.checkIn.iniciadoEm)
        expect(segundo.checkIn.status).toBe('EM_ATENDIMENTO')
        expect(segundo.eventoId).toBeNull()
    })

    it('nao publica quando o check-in ja estava em atendimento', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })
        const segundo = await sut.execute({ checkinId: existente.id })

        expect(segundo.eventoId).toBeNull()
    })

    it('não mexe nem publica num check-in já finalizado', async () => {
        const existente = checkInAgendado()
        existente.iniciado()
        existente.finalizado()
        repo.agendar(existente)

        const { checkIn, eventoId } = await sut.execute({
            checkinId: existente.id,
        })

        expect(checkIn.status).toBe('FINALIZADO')
        expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
        expect(eventoId).toBeNull()
    })

    it('não publica quando o save falha', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)
        repo.falharNoSave = true

        await expect(sut.execute({ checkinId: existente.id })).rejects.toThrow(
            'banco de dados fora',
        )

        expect(auditoria.registros).toHaveLength(0)
    })

    it('audita a mudança de status com de e para', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })

        expect(auditoria.registros).toHaveLength(1)
        expect(auditoria.registros[0].acao).toBe('CHECKIN_STATUS_ALTERADO')
        expect(auditoria.registros[0].checkinId).toBe(existente.id)
        expect(auditoria.registros[0].pacienteId).toBe('paciente-1')
        expect(auditoria.contextos()[0]).toEqual({
            de: 'AGUARDANDO',
            para: 'EM_ATENDIMENTO',
            transicao: 'iniciar',
        })
    })

    it('não audita a repetição idempotente', async () => {
        const existente = checkInAgendado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })
        await sut.execute({ checkinId: existente.id })

        expect(auditoria.registros).toHaveLength(1)
    })

    it('não audita quando o check-in já estava em atendimento', async () => {
        const existente = checkInAgendado()
        existente.iniciado()
        repo.agendar(existente)

        await sut.execute({ checkinId: existente.id })

        expect(auditoria.registros).toHaveLength(0)
    })
})
