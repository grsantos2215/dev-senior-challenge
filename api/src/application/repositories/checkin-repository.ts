import { CheckIn } from '../entities/checkin'
import { EventoOutbox } from '../entities/evento-outbox'

export abstract class CheckInRepository {
    abstract create(checkIn: CheckIn, eventos?: EventoOutbox[]): Promise<void>
    abstract findById(id: string): Promise<CheckIn | null>
    abstract findManyByPacienteId(pacienteId: string): Promise<CheckIn[]>
    abstract countManyByPacienteId(pacienteId: string): Promise<number>
    abstract save(checkIn: CheckIn, eventos?: EventoOutbox[]): Promise<void>
}
