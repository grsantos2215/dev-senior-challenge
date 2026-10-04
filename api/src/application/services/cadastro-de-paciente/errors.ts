/**
 * Erros do port de cadastro. São separados de propósito: 429 é limite de
 * vazão (volta em N segundos) e 503 é indisponibilidade (não sabe quando
 * volta). Colapsar os dois em "cadastro fora" faz a recepção dar uma
 * orientação errada na hora de avisar o paciente.
 */

export class PacienteNaoEncontrado extends Error {
    constructor(cpf: string) {
        super(`Paciente ${cpf} nao encontrado no cadastro.`)
    }
}

export class CadastroRateLimitado extends Error {
    constructor(readonly retryAfterSegundos: number) {
        super(`Cadastro rate limitado. Tentar de novo em ${retryAfterSegundos}s.`)
    }
}

export class CadastroIndisponivel extends Error {
    constructor(cause?: unknown) {
        super('Cadastro de pacientes indisponivel.', { cause })
    }
}