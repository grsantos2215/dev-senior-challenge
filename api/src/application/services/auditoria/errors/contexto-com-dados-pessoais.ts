export class ContextoComDadosPessoais extends Error {
    constructor(readonly chave: string) {
        super(
            `O contexto da auditoria não pode carregar a chave "${chave}": o log é append-only e ninguém consegue apagar o que já entrou.`,
        )
        this.name = 'ContextoComDadosPessoais'
    }
}
