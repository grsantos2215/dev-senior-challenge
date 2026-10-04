export interface CheckinCriadoEvent {
    checkinId: string
    pacienteId: string
    status: string
}

export interface CheckinIniciadoEvent {
    checkinId: string
    pacienteId: string
    status: string
}

export interface CheckinFinalizadoEvent {
    checkinId: string
    pacienteId: string
    status: string
}

export interface CheckinCanceladoEvent {
    checkinId: string
    pacienteId: string
    status: string
}

export abstract class EventosDeCheckInPort {
    abstract publicarCheckinCriado(evento: CheckinCriadoEvent): string

    abstract publicarCheckinIniciado(evento: CheckinIniciadoEvent): string

    abstract publicarCheckinFinalizado(evento: CheckinFinalizadoEvent): string

    abstract publicarCheckinCancelado(evento: CheckinCanceladoEvent): string
}