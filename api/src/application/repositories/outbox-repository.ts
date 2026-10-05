import { EventoOutbox } from '../entities/evento-outbox'

export abstract class OutboxRepository {
    abstract criar(evento: EventoOutbox): Promise<void>
    abstract listarNaoPublicados(limite: number): Promise<EventoOutbox[]>
    abstract salvar(evento: EventoOutbox): Promise<void>
}