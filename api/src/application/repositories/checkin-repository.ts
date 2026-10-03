import { CheckIn } from '../entities/checkin'

export abstract class CheckInRepository {
    abstract create(checkIn: CheckIn): Promise<void>
    abstract findById(id: string): Promise<CheckIn | null>
    abstract findManyByPacienteId(pacienteId: string): Promise<CheckIn[]>
    abstract countManyByPacienteId(pacienteId: string): Promise<number>
    abstract save(checkIn: CheckIn): Promise<void>
}
