import {
    Agendamento,
    AgendamentoPort,
} from '@/application/services/agendamento/agendamento.port'
import {
    CheckinCriadoEvent,
    CheckinIniciadoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { beforeEach, describe, expect, it } from 'vitest'

import { CheckIn } from '@/application/entities/checkin'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { CreateCheckIn } from './create-check-in'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { FakeAuditoria } from '@test/support/fake-auditoria'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { Paciente } from '@/application/entities/paciente'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

const CPF = '11111111111'
const DIA = new Date(Date.UTC(2026, 9, 4))

class FakeAgendamento extends AgendamentoPort {
    public resultado: Agendamento | null = null
    public erro: Error | null = null
    public cpfsConsultados: string[] = []

    async buscarPorCpf(cpf: string): Promise<Agendamento | null> {
        this.cpfsConsultados.push(cpf)
        if (this.erro) throw this.erro
        return this.resultado
    }
}

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
    let enriquecimento: FakeEnriquecimento
    let agendamento: FakeAgendamento
    let auditoria: FakeAuditoria = new FakeAuditoria()
    let sut: CreateCheckIn

    beforeEach(() => {
        checkins = new FakeCheckInRepository()
        pacientes = new FakePacienteRepository()
        enriquecimento = new FakeEnriquecimento()
        agendamento = new FakeAgendamento()
        auditoria.registros.length = 0
        sut = new CreateCheckIn(
            checkins,
            new GetOrCreatePaciente(pacientes, enriquecimento),
            agendamento,
            auditoria,
        )
    })

    it('cria o check-in como AGUARDANDO e AUSENTE quando o legado não tem agendamento', async () => {
        await sut.execute({ cpf: CPF, dataReferencia: DIA })

        expect(checkins.criados).toHaveLength(1)
        const [criado] = checkins.criados
        expect(criado.status).toBe('AGUARDANDO')
        expect(criado.statusAgendamento).toBe('AUSENTE')
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
            agendamento,
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

    it('marca AUSENTE quando o legado responde que não há agendamento', async () => {
        agendamento.resultado = null

        await sut.execute({ cpf: CPF, dataReferencia: DIA })

        expect(agendamento.cpfsConsultados).toEqual([CPF])
        const [criado] = checkins.criados
        expect(criado.statusAgendamento).toBe('AUSENTE')
        expect(criado.especialidade).toBeNull()
        expect(criado.medico).toBeNull()
        expect(criado.horario).toBeNull()
    })

    it('marca PRESENTE e carrega especialidade, médico e horário', async () => {
        agendamento.resultado = {
            especialidade: 'Cardiologia',
            horario: '2026-10-04T14:00:00Z',
            medico: 'Dra. Silva',
        }

        await sut.execute({ cpf: CPF, dataReferencia: DIA })

        const [criado] = checkins.criados
        expect(criado.statusAgendamento).toBe('PRESENTE')
        expect(criado.especialidade).toBe('Cardiologia')
        expect(criado.medico).toBe('Dra. Silva')
        expect(criado.horario).toBe('2026-10-04T14:00:00Z')
    })

    it('degrada para INDISPONIVEL quando o legado falha, sem perder o check-in', async () => {
        agendamento.erro = new Error('Agendamento legado indisponivel.')

        const { checkIn } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        expect(checkIn.statusAgendamento).toBe('INDISPONIVEL')
        expect(checkins.criados).toHaveLength(1)
        expect(auditoria.registros).toHaveLength(1)
    })

    it('gera o evento de outbox e retorna eventoId', async () => {
        const { checkIn, eventoId } = await sut.execute({
            cpf: CPF,
            dataReferencia: DIA,
        })

        const criado = checkins.criados[0]
        expect(criado).toBeDefined()
        expect(eventoId).toBeTruthy()
        expect(typeof eventoId).toBe('string')
    })

    it('não publica quando a gravação falha', async () => {
        checkins.create = async () => {
            throw new Error('db fora')
        }

        await expect(
            sut.execute({ cpf: CPF, dataReferencia: DIA }),
        ).rejects.toThrow('db fora')
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
            statusAgendamento: 'AUSENTE',
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
    })
})
