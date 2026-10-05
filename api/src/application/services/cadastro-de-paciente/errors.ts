export class PacienteNaoEncontrado extends Error {
    constructor() {
        super('Paciente não encontrado no cadastro.')
    }
}

export class CadastroRateLimitado extends Error {
    constructor(readonly retryAfterSegundos: number) {
        super(
            `Cadastro rate limitado. Tentar de novo em ${retryAfterSegundos}s.`,
        )
    }
}

export class CadastroIndisponivel extends Error {
    constructor(cause?: unknown) {
        super('Cadastro de pacientes indisponível.', { cause })
    }
}
