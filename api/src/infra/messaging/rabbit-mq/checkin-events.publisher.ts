import {
    CheckinCanceladoEvent,
    CheckinCriadoEvent,
    CheckinFinalizadoEvent,
    CheckinIniciadoEvent,
    EventosDeCheckInPort,
} from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ClientRMQ } from '@nestjs/microservices'
import { randomUUID } from 'node:crypto'

import { CHECKIN_EXCHANGE } from './fila'
import { RabbitPublisher } from '../rabbit-publisher'

export { CHECKIN_EXCHANGE }

export const CHECKIN_CREATED_ROUTING_KEY = 'checkin.created'
export const CHECKIN_STARTED_ROUTING_KEY = 'checkin.iniciado'
export const CHECKIN_FINISHED_ROUTING_KEY = 'checkin.finalizado'
export const CHECKIN_CANCELLED_ROUTING_KEY = 'checkin.cancelado'
export const RMQ_CLIENT = Symbol('RMQ_CLIENT')

export type CheckinCreatedEvent = CheckinCriadoEvent & {
    eventId: string
    occurredAt: string
}

export type CheckinStartedEvent = CheckinIniciadoEvent & {
    eventId: string
    occurredAt: string
}

export type CheckinFinishedEvent = CheckinFinalizadoEvent & {
    eventId: string
    occurredAt: string
}

export type CheckinCancelledEvent = CheckinCanceladoEvent & {
    eventId: string
    occurredAt: string
}

export function createRmqClient(config: ConfigService): ClientRMQ {
    return new ClientRMQ({
        urls: [config.getOrThrow<string>('BROKER_URL')],
        exchange: CHECKIN_EXCHANGE,
        exchangeType: 'topic',
        wildcards: true,
        persistent: true,
    })
}

@Injectable()
export class CheckinEventsPublisher extends EventosDeCheckInPort {
    private readonly logger = new Logger(CheckinEventsPublisher.name)

    constructor(private readonly publisher: RabbitPublisher) {
        super()
    }

    publicarCheckinCriado(evento: CheckinCriadoEvent): string {
        const completo: CheckinCreatedEvent = {
            ...evento,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
        }

        void this.publisher.publicar(CHECKIN_CREATED_ROUTING_KEY, completo)

        this.logger.log(
            `checkin criado checkinId=${completo.checkinId} eventoId=${completo.eventId}`,
        )

        return completo.eventId
    }

    publicarCheckinIniciado(evento: CheckinIniciadoEvent): string {
        const completo: CheckinStartedEvent = {
            ...evento,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
        }

        void this.publisher.publicar(CHECKIN_STARTED_ROUTING_KEY, completo)

        this.logger.log(
            `checkin iniciado checkinId=${completo.checkinId} status=${completo.status} eventoId=${completo.eventId}`,
        )

        return completo.eventId
    }

    publicarCheckinFinalizado(evento: CheckinFinalizadoEvent): string {
        const completo: CheckinFinishedEvent = {
            ...evento,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
        }

        void this.publisher.publicar(CHECKIN_FINISHED_ROUTING_KEY, completo)

        this.logger.log(
            `checkin finalizado checkinId=${completo.checkinId} status=${completo.status} eventoId=${completo.eventId}`,
        )

        return completo.eventId
    }

    publicarCheckinCancelado(evento: CheckinCanceladoEvent): string {
        const completo: CheckinCancelledEvent = {
            ...evento,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
        }

        void this.publisher.publicar(CHECKIN_CANCELLED_ROUTING_KEY, completo)

        this.logger.log(
            `checkin cancelado checkinId=${completo.checkinId} status=${completo.status} eventoId=${completo.eventId}`,
        )

        return completo.eventId
    }
}