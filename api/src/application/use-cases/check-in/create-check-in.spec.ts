import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import {
    CheckinCriadoEvent,
    CheckinIniciadoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { Paciente } from '@/application/entities/paciente'
import { PacienteRepository } from '@/application/repositories/paciente-repository'
import { beforeEach, describe, expect, it } from 'vitest'

import { CreateCheckIn } from './create-check-in'
import { FakeAuditoria } from '@/helpers/fake-auditoria'

const CPF = '11111111111'
const DIA = new Date(Date.UTC(2026, 9, 4))

class FakeCheckInRepository implements CheckInRepository {
    public readonly criados: CheckIn[] = []

    async create(checkIn: CheckIn): Promise<void> {
        this.criados.push(checkIn)
    }

    async findById(): Promise<CheckIn | null> {
        return null
    }

    async findManyByPacienteId(): Promise<CheckIn[]> {
        return this.criados
    }

    async countManyByPacienteId(): Promise<number> {
        return this.criados.length
    }

    async save(checkIn: CheckIn): Promise<void> {
        this.criados.push(checkIn)
    }
}

class FakePacienteRepository implements PacienteRepository {
    public readonly criados: Paciente[] = []

    async create(paciente: Paciente): Promise<void> {
        this.criados.push(paciente)
    }

    async findByCpf(cpf: string): Promise<Paciente | null> {
        return this.criados.find((p) => p.cpf === cpf) ?? null
    }

    async findById(id: string): Promise<Paciente | null> {
        return this.criados.find((p) => p.id === id) ?? null
    }

    async save(): Promise<void> {}
}

class FakeEventos extends EventosDeCheckInPort {
    public readonly publicados: CheckinCriadoEvent[] = []
    public readonly iniciados: CheckinIniciadoEvent[] = []

    publicarCheckinCriado(evento: CheckinCriadoEvent): string {
        this.publicados.push(evento)
        return `evento-${this.publicados.length}`
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

class FakeEnriquecimento extends EnriquecimentoDeCadastroPort {
    public falhar = false

    async enfileirar(): Promise<void> {
        throw new Error('enfileirar nao deveria ser usado neste teste')
    }

    async enfileirarSemBloquear(): Promise<void> {
        if (this.falhar) throw new Error('broker fora')
    }
}

describe('CreateCheckIn', () => {
    let checkins: FakeCheckInRepository
    let pacientes: FakePacienteRepository
    let eventos: FakeEventos
    let enriquecimento: FakeEnriquecimento
    let auditoria: FakeAuditoria
    let sut: CreateCheckIn

    beforeEach(() => {
        checkins = new FakeCheckInRepository()
        pacientes = new FakePacienteRepository()
        eventos = new FakeEventos()
        enriquecimento = new FakeEnriquecimento()
        auditoria = new FakeAuditoria()
        sut = new CreateCheckIn(
            checkins,
            new GetOrCreatePaciente(pacientes, enriquecimento),
            eventos,
            auditoria,
        )
    })

    it('cria o check-in como AGUARDANDO e INDISPONIVEL', async () => {
        await sut.execute({ cpf: CPF, dataReferencia: DIA })

        expect(checkins.criados).toHaveLength(1)
        const [criado] = checkins.criados
        expect(criado.status).toBe('AGUARDANDO')
        expect(criado.statusAgendamento).toBe('INDISPONIVEL')
        expect(criado.especialidade).toBeNull()
        expect(criado.medico).toBeNull()
        expect(criado.horario).toBeNull()
        expect(criado.dataReferencia).toEqual(DIA)
    })

    it('liga o check-in ao paciente resolvido', async () => {
        const { checkIn, pacienteId } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        expect(pacientes.criados).toHaveLength(1)
        expect(checkIn.pacienteId).toBe(pacientes.criados[0].id)
        expect(pacienteId).toBe(pacientes.criados[0].id)
    })

    it('propaga enriquecimentoPendente sem virar erro', async () => {
        enriquecimento.falhar = true
        sut = new CreateCheckIn(
            checkins,
            new GetOrCreatePaciente(pacientes, enriquecimento),
            eventos,
            auditoria,
        )

        const { enriquecimentoPendente, nome } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        expect(enriquecimentoPendente).toBe(true)
        expect(nome).toBeNull()
        expect(checkins.criados).toHaveLength(1)
    })

    it('publica checkin.created com o id do check-in gravado', async () => {
        const { checkIn, eventoId } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        expect(eventos.publicados).toHaveLength(1)
        expect(eventos.publicados[0]).toEqual({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: 'AGUARDANDO',
        })
        expect(eventoId).toBe('evento-1')
    })

    it('não publica quando a gravação falha', async () => {
        checkins.create = async () => {
            throw new Error('db fora')
        }

        await expect(
            sut.execute({ cpf: CPF, dataReferencia: DIA }),
        ).rejects.toThrow('db fora')
        expect(eventos.publicados).toHaveLength(0)
        expect(auditoria.registros).toHaveLength(0)
    })

    it('audita a criação sem levar cpf nem nome', async () => {
        const { checkIn } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        expect(auditoria.registros).toHaveLength(1)
        expect(auditoria.registros[0].acao).toBe('CHECKIN_CRIADO')
        expect(auditoria.registros[0].checkinId).toBe(checkIn.id)
        expect(auditoria.registros[0].pacienteId).toBe(checkIn.pacienteId)
        expect(auditoria.contextos()[0]).toEqual({
            status: 'AGUARDANDO',
            statusAgendamento: 'INDISPONIVEL',
            enriquecimentoPendente: true,
        })
        expect(JSON.stringify(auditoria.contextos())).not.toContain(CPF)
    })

    it('deixa o CheckInJaAberto subir do repositório', async () => {
        checkins.create = async () => {
            throw new CheckInJaAberto('paciente-1', DIA)
        }

        await expect(
            sut.execute({ cpf: CPF, dataReferencia: DIA }),
        ).rejects.toBeInstanceOf(CheckInJaAberto)
        expect(eventos.publicados).toHaveLength(0)
    })
})
