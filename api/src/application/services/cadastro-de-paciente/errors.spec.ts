import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from './errors'
import { describe, expect, it } from 'vitest'

describe('erros do port de cadastro', () => {
    it('PacienteNaoEncontrado não embute CPF na mensagem', () => {
        const erro = new PacienteNaoEncontrado()

        expect(erro.message).not.toMatch(/\d{11}/)
        expect(erro.message).not.toContain('cpf')
        expect(erro.message).toBe('Paciente não encontrado no cadastro.')
    })

    it('CadastroIndisponivel não embute a causa na mensagem', () => {
        const erro = new CadastroIndisponivel(
            new Error('GET http://cadastro/cpf=12345678901 falhou'),
        )

        expect(erro.message).not.toContain('12345678901')
        // A causa fica em `cause`, acessível por código, não interpolada.
        expect(erro.cause).toBeDefined()
    })

    it('CadastroRateLimitado carrega o retryAfter, que não é dado pessoal', () => {
        const erro = new CadastroRateLimitado(7)

        expect(erro.retryAfterSegundos).toBe(7)
        expect(erro.message).toContain('7s')
    })
})
