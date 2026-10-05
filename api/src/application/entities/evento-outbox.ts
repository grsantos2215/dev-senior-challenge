export type TipoEventoCheckin =
    | 'CHECKIN_CRIADO'
    | 'CHECKIN_INICIADO'
    | 'CHECKIN_FINALIZADO'
    | 'CHECKIN_CANCELADO'

export interface EventoOutboxProps {
    tipo: TipoEventoCheckin
    routingKey: string
    payload: Record<string, unknown>
    checkinId: string
    eventoId: string
    occurredAt: Date
    tentativas?: number
    criadoEm?: Date
    publicadoEm?: Date | null
}

export class EventoOutbox {
    private _id: string
    private props: EventoOutboxProps & {
        tentativas: number
        criadoEm: Date
        publicadoEm: Date | null
    }

    constructor(props: EventoOutboxProps) {
        this._id = props.eventoId
        this.props = {
            ...props,
            tentativas: props.tentativas ?? 0,
            criadoEm: props.criadoEm ?? new Date(),
            publicadoEm: props.publicadoEm ?? null,
        }
    }

    public static criar(props: EventoOutboxProps): EventoOutbox {
        return new EventoOutbox(props)
    }

    public static hidratar(id: string, props: EventoOutboxProps & {
        tentativas: number
        criadoEm: Date
        publicadoEm: Date | null
    }): EventoOutbox {
        const evento = new EventoOutbox({
            ...props,
            eventoId: id,
            tentativas: props.tentativas,
            criadoEm: props.criadoEm,
            publicadoEm: props.publicadoEm,
        })
        return evento
    }

    get id(): string {
        return this._id
    }

    get tipo(): TipoEventoCheckin {
        return this.props.tipo
    }

    get routingKey(): string {
        return this.props.routingKey
    }

    get payload(): Record<string, unknown> {
        return this.props.payload
    }

    get checkinId(): string {
        return this.props.checkinId
    }

    get eventoId(): string {
        return this.props.eventoId
    }

    get occurredAt(): Date {
        return this.props.occurredAt
    }

    get tentativas(): number {
        return this.props.tentativas
    }

    get criadoEm(): Date {
        return this.props.criadoEm
    }

    get publicadoEm(): Date | null {
        return this.props.publicadoEm
    }

    public marcarTentativa(): void {
        this.props.tentativas += 1
    }

    public marcarPublicado(): void {
        this.props.publicadoEm = new Date()
    }

    public toJSON() {
        return { id: this._id, ...this.props }
    }
}