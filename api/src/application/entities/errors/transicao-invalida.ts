export class TransicaoInvalida extends Error {
    constructor(
        readonly statusAtual: string,
        message: string,
    ) {
        super(message)
        this.name = 'TransicaoInvalida'
    }
}
