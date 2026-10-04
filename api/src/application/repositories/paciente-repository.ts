import { Paciente } from '@/application/entities/paciente'

export abstract class PacienteRepository {
    abstract create(paciente: Paciente): Promise<void>
    abstract findByCpf(cpf: string): Promise<Paciente | null>
    abstract findById(id: string): Promise<Paciente | null>
    abstract save(paciente: Paciente): Promise<void>
}
