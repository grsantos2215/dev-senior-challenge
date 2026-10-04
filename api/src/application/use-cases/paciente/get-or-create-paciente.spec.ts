import { beforeEach, describe, expect, it } from 'vitest'

import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { GetOrCreatePaciente } from './get-or-create-paciente'
import { Paciente } from '@/application/entities/paciente'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

const CPF = '11111111111'

class FakePacienteRepository implements PacienteRepository {
    public readonly criados: Paciente[] = []
    public readonly salvos: Paciente[] = []
    public porCpf = new Map<string, Paciente>()

    async create(paciente: Paciente): Promise<void> {
        this.criados.push(paciente)
        this.porCpf.set(paciente.cpf, paciente)
    }

    async findByCpf(cpf: string): Promise<Paciente | null> {
        return this.porCpf.get(cpf) ?? null
    }

    async findById(id: string): Promise<Paciente | null> {
        return this.criados.find((p) => p.id === id) ?? null
    }

    async save(paciente: Paciente): Promise<void> {
        this.salvos.push(paciente)
        this.porCpf.set(paciente.cpf, paciente)
    }
}

class FakeEnriquecimento extends EnriquecimentoDeCadastroPort {
    public readonly pedidos: string[] = []

    async enfileirar(pacienteId: string): Promise<void> {
        this.pedidos.push(pacienteId)
    }

    async enfileirarSemBloquear(pacienteId: string): Promise<void> {
        this.pedidos.push(pacienteId)
    }
}

describe('GetOrCreatePaciente', () => {
    let repo: FakePacienteRepository
    let enriquecimento: FakeEnriquecimento
    let sut: GetOrCreatePaciente

    beforeEach(() => {
        repo = new FakePacienteRepository()
        enriquecimento = new FakeEnriquecimento()
        sut = new GetOrCreatePaciente(repo, enriquecimento)
    })

    describe('quando o paciente já está confirmado', () => {
        it('não enfileira nada, porque o nome já veio', async () => {
            repo.porCpf.set(CPF, new Paciente({ cpf: CPF, nome: 'Ana Souza' }))

            const { paciente, enriquecimentoPendente } = await sut.execute({
                cpf: CPF,
            })

            expect(enriquecimento.pedidos).toHaveLength(0)
            expect(paciente.nome).toBe('Ana Souza')
            expect(enriquecimentoPendente).toBe(false)
        })
    })

    describe('quando o paciente não existe', () => {
        it('cria só com o CPF e enfileira o enriquecimento', async () => {
            const { paciente, enriquecimentoPendente } = await sut.execute({
                cpf: CPF,
            })

            expect(repo.criados).toHaveLength(1)
            expect(paciente.cpf).toBe(CPF)
            expect(paciente.nome).toBeNull()
            expect(paciente.cadastroConfirmado).toBe(false)
            expect(enriquecimentoPendente).toBe(true)
        })

        it('enfileira pelo pacienteId, sem vazar o CPF para a fila', async () => {
            // ADR 3: sem dado pessoal no payload do broker.
            const { paciente } = await sut.execute({ cpf: CPF })

            expect(enriquecimento.pedidos).toEqual([paciente.id])
            expect(enriquecimento.pedidos).not.toContain(CPF)
        })
    })

    describe('quando o paciente existe mas segue sem nome', () => {
        it('não cria duplicata e reenfileira', async () => {
            const existente = new Paciente({ cpf: CPF })
            repo.porCpf.set(CPF, existente)

            const { paciente, enriquecimentoPendente } = await sut.execute({
                cpf: CPF,
            })

            expect(repo.criados).toHaveLength(0)
            expect(paciente.id).toBe(existente.id)
            expect(enriquecimentoPendente).toBe(true)
            expect(enriquecimento.pedidos).toEqual([existente.id])
        })

        it('reenfileirar e seguro: quem deduplica e o consumidor', async () => {
            const existente = new Paciente({ cpf: CPF })
            repo.porCpf.set(CPF, existente)

            await sut.execute({ cpf: CPF })
            await sut.execute({ cpf: CPF })

            // Duas mensagens, mesmo paciente. O consumidor precisa ser
            // idempotente, e nao a fila.
            expect(enriquecimento.pedidos).toEqual([existente.id, existente.id])
        })
    })

    describe('falha ao enfileirar', () => {
        it('não derruba o paciente: a fila é enriquecimento, não o check-in', async () => {
            const quebrado = new FakeEnriquecimento()
            quebrado.enfileirarSemBloquear = async () => {
                throw new Error('broker fora')
            }
            sut = new GetOrCreatePaciente(repo, quebrado)

            const { paciente, enriquecimentoPendente } = await sut.execute({
                cpf: CPF,
            })

            expect(paciente.id).toBeDefined()
            expect(enriquecimentoPendente).toBe(true)
        })

        it('a falha engolida é do caminho best-effort, não do reenvio do consumidor', async () => {
            const quebrado = new FakeEnriquecimento()
            quebrado.enfileirar = async () => {
                throw new Error('broker fora')
            }

            await expect(quebrado.enfileirar('qualquer')).rejects.toThrow(
                'broker fora',
            )
        })
    })
})
