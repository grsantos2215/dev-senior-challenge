import { AcaoLog } from '@/generated/prisma/enums'
import { ContextoComDadosPessoais } from '@/application/services/auditoria/errors/contexto-com-dados-pessoais'
import { randomUUID } from 'node:crypto'

const CHAVES_PROIBIDAS = new Set([
    'cpf',
    'cnpj',
    'rg',
    'nome',
    'sobrenome',
    'nomecompleto',
    'nascimento',
    'datanascimento',
    'data_nascimento',
    'email',
    'telefone',
    'celular',
    'endereco',
    'logradouro',
])

export interface RegistroAuditoriaProps {
    acao: AcaoLog
    contexto?: Record<string, unknown> | null
    checkinId?: string | null
    pacienteId?: string | null
    ip?: string | null
    hostname?: string | null
}

export class RegistroAuditoria {
    readonly id: string
    readonly criadoEm: Date

    constructor(
        readonly acao: AcaoLog,
        readonly contexto: Record<string, unknown> | null = null,
        readonly checkinId: string | null = null,
        readonly pacienteId: string | null = null,
        readonly ip: string | null = null,
        readonly hostname: string | null = null,
    ) {
        this.id = randomUUID()
        this.criadoEm = new Date()

        this.recusarDadoPessoal()
    }

    private recusarDadoPessoal(): void {
        const encontrada = this.chaveProibida(this.contexto)

        if (encontrada) throw new ContextoComDadosPessoais(encontrada)
    }

    private chaveProibida(valor: unknown): string | null {
        if (Array.isArray(valor)) {
            for (const item of valor) {
                const encontrada = this.chaveProibida(item)

                if (encontrada) return encontrada
            }

            return null
        }

        if (valor === null || typeof valor !== 'object') return null

        for (const [chave, filho] of Object.entries(valor)) {
            if (CHAVES_PROIBIDAS.has(chave.toLowerCase())) return chave

            const encontrada = this.chaveProibida(filho)

            if (encontrada) return encontrada
        }

        return null
    }
}
