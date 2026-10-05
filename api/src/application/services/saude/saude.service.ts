export interface EstadoDeDependencia {
    nome: string
    saudavel: boolean
    detalhe?: string
}

export interface RelatorioDeSaude {
    status: 'ok' | 'degradado'
    dependencias: EstadoDeDependencia[]
}

export interface ChecagemDeDependencia {
    readonly nome: string
    verificar(): Promise<void>
}

export const CHEGAGENS_DE_DEPENDENCIA = 'CHEGAGENS_DE_DEPENDENCIA'

export class SaudeService {
    constructor(private readonly checagens: readonly ChecagemDeDependencia[]) {}

    async verificar(): Promise<RelatorioDeSaude> {
        const dependencias = await Promise.all(
            this.checagens.map(async (checagem) => {
                try {
                    await checagem.verificar()
                    return { nome: checagem.nome, saudavel: true }
                } catch (erro) {
                    return {
                        nome: checagem.nome,
                        saudavel: false,
                        detalhe:
                            erro instanceof Error
                                ? erro.message
                                : 'verificação falhou',
                    }
                }
            }),
        )

        return {
            status: dependencias.every((d) => d.saudavel) ? 'ok' : 'degradado',
            dependencias,
        }
    }
}
