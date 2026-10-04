export interface PacienteCadastrado {
    nome: string
    dataNascimento: Date
}

/**
 * Port de saída para o cadastro externo de pacientes. Lança
 * `PacienteNaoEncontrado`, `CadastroRateLimitado` ou `CadastroIndisponivel` —
 * nunca devolve null, para não confundir "não existe" com "não deu para
 * perguntar".
 *
 * A porta não decide degradar: quem decide é o caso de uso, porque só ele sabe
 * se o fluxo pode seguir sem o dado.
 */
export abstract class CadastroPort {
    abstract buscarPorCpf(cpf: string): Promise<PacienteCadastrado | null>
}
