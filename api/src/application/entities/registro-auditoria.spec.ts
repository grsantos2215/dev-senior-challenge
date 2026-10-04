import { RegistroAuditoria } from './registro-auditoria'
import { describe, expect, it } from 'vitest'

describe('RegistroAuditoria', () => {
    describe('quando o contexto não carrega dado pessoal', () => {
        it('aceita contexto com ids e status', () => {
            const registro = new RegistroAuditoria('CHECKIN_CRIADO', {
                status: 'AGUARDANDO',
                pacienteId: 'abc',
            })

            expect(registro.acao).toBe('CHECKIN_CRIADO')
            expect(registro.contexto).toEqual({
                status: 'AGUARDANDO',
                pacienteId: 'abc',
            })
        })

        it('aceita contexto ausente', () => {
            const registro = new RegistroAuditoria('CADASTRO_CONSULTADO')

            expect(registro.contexto).toBeNull()
        })
    })

    describe('quando o contexto carrega dado pessoal', () => {
        it.each([
            ['cpf', { cpf: '12345678901' }],
            ['nome', { nome: 'Maria Silva' }],
            ['nascimento', { dataNascimento: '1990-01-01' }],
            ['email', { email: 'maria@exemplo.com' }],
            ['telefone', { telefone: '11999999999' }],
        ])('recusa a chave %s', (_nome, contexto) => {
            expect(
                () => new RegistroAuditoria('CHECKIN_CRIADO', contexto),
            ).toThrow(/não pode carregar a chave/)
        })

        it('recusa a chave mesmo em aninhamento profundo', () => {
            expect(
                () =>
                    new RegistroAuditoria('CHECKIN_CRIADO', {
                        tentativa: { interna: { cpf: '12345678901' } },
                    }),
            ).toThrow(/não pode carregar a chave/)
        })

        it('recusa a chave dentro de array', () => {
            expect(
                () =>
                    new RegistroAuditoria('CHECKIN_CRIADO', {
                        itens: [{ ok: 1 }, { nome: 'Maria' }],
                    }),
            ).toThrow(/não pode carregar a chave/)
        })
    })
})
