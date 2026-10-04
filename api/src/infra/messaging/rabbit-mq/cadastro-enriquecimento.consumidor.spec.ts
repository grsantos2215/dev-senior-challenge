import { beforeEach, describe, expect, it } from 'vitest'

import {
    CadastroPort,
    PacienteCadastrado,
} from '@/application/services/cadastro-de-paciente/cadastro.port'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from '@/application/services/cadastro-de-paciente/errors'
import { PacienteRepository } from '@/application/repositories/paciente-repository'
import { Paciente } from '@/application/entities/paciente'
import { FakeAuditoria } from '@test/support/fake-auditoria'
import { ConfigService } from '@nestjs/config'

import { CadastroEnriquecimentoConsumidor } from './cadastro-enriquecimento.consumidor'
import { MAX_TENTATIVAS } from './cadastro-enriquecimento.publisher'

const CPF = '11111111111'
const PACIENTE_ID = 'p-1'

class FakePacienteRepository implements PacienteRepository {
    public readonly salvos: Paciente[] = []
    public paciente: Paciente | null = null

    async create(): Promise<void> {}

    async findByCpf(): Promise<Paciente | null> {
        return this.paciente
    }

    async findById(): Promise<Paciente | null> {
        return this.paciente
    }

    async save(paciente: Paciente): Promise<void> {
        this.salvos.push(paciente)
    }
}

class FakeCadastro extends CadastroPort {
    public erro: Error | null = null

    constructor(private readonly resposta: PacienteCadastrado | null) {
        super()
    }

    async buscarPorCpf(): Promise<PacienteCadastrado | null> {
        if (this.erro) throw this.erro
        return this.resposta
    }
}

class FakeEnriquecimento extends EnriquecimentoDeCadastroPort {
    public readonly pedidos: Array<{ pacienteId: string; tentativa: number }> =
        []
    public falha = false

    async enfileirar(pacienteId: string, tentativa = 1): Promise<void> {
        if (this.falha) throw new Error('broker fora')
        this.pedidos.push({ pacienteId, tentativa })
    }

    async enfileirarSemBloquear(pacienteId: string): Promise<void> {
        this.pedidos.push({ pacienteId, tentativa: 1 })
    }
}

function configuracao(): ConfigService {
    return { get: () => 1 } as unknown as ConfigService
}

describe('CadastroEnriquecimentoConsumidor', () => {
    let repo: FakePacienteRepository
    let enriquecimento: FakeEnriquecimento
    let auditoria: FakeAuditoria
    let pacienteDegradado: () => Paciente

    beforeEach(() => {
        repo = new FakePacienteRepository()
        enriquecimento = new FakeEnriquecimento()
        auditoria = new FakeAuditoria()
        pacienteDegradado = () => new Paciente({ cpf: CPF, nome: null })
    })

    function sut(cadastro: FakeCadastro): CadastroEnriquecimentoConsumidor {
        return new CadastroEnriquecimentoConsumidor(
            repo,
            cadastro,
            enriquecimento,
            auditoria,
            configuracao(),
        )
    }

    describe('enriquecimento', () => {
        it('enriquece e devolve o resultado', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro({
                nome: 'Ana Souza',
                dataNascimento: new Date('1988-03-12'),
            })

            const resultado = await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            expect(resultado).toEqual({ status: 'enriquecido' })
            expect(repo.salvos).toHaveLength(1)
        })

        it.each([
            ['paciente-inexistente', null, null],
            ['cpf-desconhecido', new Paciente({ cpf: CPF, nome: null }), null],
        ])(
            'descarta por %s, sem chamar o cadastro',
            async (_motivo, paciente, resposta) => {
                repo.paciente = paciente
                const cadastro = new FakeCadastro(resposta)

                await sut(cadastro).handle({
                    pacienteId: PACIENTE_ID,
                    tentativa: 1,
                })
            },
        )

        it('não chama o cadastro quando o paciente já estava confirmado', async () => {
            repo.paciente = new Paciente({ cpf: CPF, nome: 'Ana Souza' })

            const resultado = await sut(new FakeCadastro(null)).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            expect(resultado).toEqual({
                status: 'descartado',
                motivo: 'ja-confirmado',
            })
        })
    })

    describe('retry', () => {
        it.each([
            ['rate limit', new CadastroRateLimitado(429)],
            ['indisponivel', new CadastroIndisponivel('500')],
            ['nao encontrado', new PacienteNaoEncontrado(CPF)],
        ])(
            'reenfileira com a tentativa seguinte em %s',
            async (_nome, erro) => {
                repo.paciente = pacienteDegradado()
                const cadastro = new FakeCadastro(null)
                cadastro.erro = erro

                const resultado = await sut(cadastro).handle({
                    pacienteId: PACIENTE_ID,
                    tentativa: 1,
                })

                expect(resultado).toEqual({ status: 'adiado', tentativa: 2 })
                expect(enriquecimento.pedidos).toEqual([
                    { pacienteId: PACIENTE_ID, tentativa: 2 },
                ])
            },
        )

        it('desiste sem reenfileirar quando as tentativas acabaram', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro(null)
            cadastro.erro = new CadastroIndisponivel('500')

            const resultado = await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: MAX_TENTATIVAS,
            })

            expect(resultado).toEqual({
                status: 'desistido',
                tentativas: MAX_TENTATIVAS,
            })
            expect(enriquecimento.pedidos).toHaveLength(0)
        })
    })

    describe('falha inesperada', () => {
        it('não reenfileira defeito do adapter, para não virar retry infinito', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro(null)
            cadastro.erro = new TypeError('adapter explodiu')

            const resultado = await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            expect(resultado).toEqual({
                status: 'falha',
                motivo: 'adapter explodiu',
            })
            expect(enriquecimento.pedidos).toHaveLength(0)
        })

        it('propaga a falha quando o reenvio não consegue publicar', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro(null)
            cadastro.erro = new CadastroRateLimitado(429)
            enriquecimento.falha = true

            await expect(
                sut(cadastro).handle({ pacienteId: PACIENTE_ID, tentativa: 1 }),
            ).rejects.toThrow('broker fora')
        })
    })

    describe('auditoria', () => {
        it('registra CADASTRO_CONSULTADO ao enriquecer', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro({
                nome: 'Ana Souza',
                dataNascimento: new Date(Date.UTC(1990, 0, 1)),
            })

            await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            expect(auditoria.registros).toHaveLength(1)
            expect(auditoria.registros[0].acao).toBe('CADASTRO_CONSULTADO')
            expect(auditoria.registros[0].pacienteId).toBe(PACIENTE_ID)
            expect(auditoria.contextos()[0]).toEqual({ tentativa: 1 })
        })

        it('registra INTEGRACAO_FALHOU quando reenvia', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro(null)
            cadastro.erro = new CadastroRateLimitado(429)

            await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            expect(auditoria.acoes()).toEqual(['INTEGRACAO_FALHOU'])
            expect(auditoria.contextos()[0]).toMatchObject({
                integracao: 'cadastro',
                erro: 'CadastroRateLimitado',
                tentativa: 1,
            })
        })

        it('marca a desistencia quando estoura as tentativas', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro(null)
            cadastro.erro = new CadastroIndisponivel(503)

            await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: MAX_TENTATIVAS,
            })

            expect(auditoria.contextos()[0]).toMatchObject({
                desistencia: true,
                tentativa: MAX_TENTATIVAS,
            })
        })

        it('nunca escreve cpf ou nome no contexto', async () => {
            repo.paciente = pacienteDegradado()
            const cadastro = new FakeCadastro({
                nome: 'Ana Souza',
                dataNascimento: new Date(Date.UTC(1990, 0, 1)),
            })

            await sut(cadastro).handle({
                pacienteId: PACIENTE_ID,
                tentativa: 1,
            })

            const serializado = JSON.stringify(auditoria.contextos())

            expect(serializado).not.toContain(CPF)
            expect(serializado).not.toContain('Ana Souza')
        })
    })
})
