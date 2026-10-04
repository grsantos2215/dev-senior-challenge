import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

export abstract class AuditoriaPort {
    abstract registrar(registro: RegistroAuditoria): Promise<void>

    abstract findManyByCheckIn(checkinId: string): Promise<RegistroAuditoria[]>

    abstract findManyByPaciente(
        pacienteId: string,
    ): Promise<RegistroAuditoria[]>
}
