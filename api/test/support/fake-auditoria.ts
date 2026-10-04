import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

export class FakeAuditoria implements AuditoriaPort {
    public readonly registros: RegistroAuditoria[] = []
    public falharAoRegistrar = false

    async registrar(registro: RegistroAuditoria): Promise<void> {
        if (this.falharAoRegistrar) throw new Error('auditoria fora do ar')

        this.registros.push(registro)
    }

    async findManyByCheckIn(): Promise<RegistroAuditoria[]> {
        return this.registros
    }

    async findManyByPaciente(): Promise<RegistroAuditoria[]> {
        return this.registros
    }

    public acoes(): string[] {
        return this.registros.map((registro) => registro.acao)
    }

    public contextos(): Record<string, unknown>[] {
        return this.registros
            .map((registro) => registro.contexto)
            .filter(
                (contexto): contexto is Record<string, unknown> =>
                    contexto !== null,
            )
    }
}
