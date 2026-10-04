import { describe, expect, it } from 'vitest'

import { Paciente } from './paciente'

const CPF_VALIDO = '11111111111'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_FIXO = '11111111-1111-4111-8111-111111111111'

describe('Paciente', () => {
    describe('construtor', () => {
        it('gera um id UUID', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            expect(paciente.id).toMatch(UUID)
        })

        it('normaliza ausência de nome e data para null', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            expect(paciente.nome).toBeNull()
            expect(paciente.dataNascimento).toBeNull()
        })

        it('rejeita nome que só tem espaco, em vez de tratar como ausência', () => {
            // Ausencia e `null`/undefined. String vazia e lixo, e lixo nao
            // entra degradado: viraria "cadastro confirmado" sem nome.
            expect(() => new Paciente({ cpf: CPF_VALIDO, nome: '' })).toThrow(
                /string vazia/,
            )
            expect(
                () => new Paciente({ cpf: CPF_VALIDO, nome: '   ' }),
            ).toThrow(/string vazia/)
        })

        it('preenche dataNascimento quando vem', () => {
            const data = new Date('1990-05-05T00:00:00Z')
            const paciente = new Paciente({
                cpf: CPF_VALIDO,
                nome: 'Ana Souza',
                dataNascimento: data,
            })

            expect(paciente.dataNascimento).toBe(data)
        })

        it('rejeita CPF que não tem 11 digitos', () => {
            expect(() => new Paciente({ cpf: '111' })).toThrow(/11 digitos/)
            expect(() => new Paciente({ cpf: '111.111.111-11' })).toThrow(
                /11 digitos/,
            )
        })
    })

    describe('hidratar', () => {
        it('aceita um id que já existe', () => {
            const paciente = Paciente.hidratar(UUID_FIXO, { cpf: CPF_VALIDO })

            expect(paciente.id).toBe(UUID_FIXO)
        })

        it('rejeita id que não é UUID, porque seria bug de mapeamento', () => {
            expect(() =>
                Paciente.hidratar('id-que-nao-existe', { cpf: CPF_VALIDO }),
            ).toThrow(/UUID/)
        })
    })

    describe('cadastroConfirmado', () => {
        it('é falso quando o paciente só tem CPF', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            expect(paciente.cadastroConfirmado).toBe(false)
        })

        it('é verdadeiro quando o nome veio do cadastro', () => {
            const paciente = new Paciente({
                cpf: CPF_VALIDO,
                nome: 'Ana Souza',
            })

            expect(paciente.cadastroConfirmado).toBe(true)
        })
    })

    describe('set nome', () => {
        it('atualiza e revalida', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            paciente.nome = 'Ana Souza'

            expect(paciente.nome).toBe('Ana Souza')
            expect(paciente.cadastroConfirmado).toBe(true)
        })

        it('volta para null quando recebe undefined', () => {
            const paciente = new Paciente({
                cpf: CPF_VALIDO,
                nome: 'Ana Souza',
            })

            paciente.nome = undefined

            expect(paciente.nome).toBeNull()
        })

        it('não deixa o objeto corrompido quando a validação falha', () => {
            const paciente = new Paciente({
                cpf: CPF_VALIDO,
                nome: 'Ana Souza',
            })

            expect(() => {
                paciente.nome = '   '
            }).toThrow(/string vazia/)

            // O rollback tem que devolver o valor bom, nao o anterior-invalido.
            expect(paciente.nome).toBe('Ana Souza')
            expect(paciente.cadastroConfirmado).toBe(true)
        })
    })

    describe('cpf', () => {
        it('não tem setter: mudar a chave natural apontaria para outra pessoa', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            expect('cpf' in paciente).toBe(true)
            expect(
                Object.getOwnPropertyDescriptor(Paciente.prototype, 'cpf')?.set,
            ).toBeUndefined()
        })
    })

    describe('toJSON', () => {
        it('serializa nome e dataAusentes como null, nunca undefined', () => {
            const paciente = new Paciente({ cpf: CPF_VALIDO })

            expect(paciente.toJSON()).toMatchObject({
                id: paciente.id,
                cpf: CPF_VALIDO,
                nome: null,
                dataNascimento: null,
            })
        })
    })
})
