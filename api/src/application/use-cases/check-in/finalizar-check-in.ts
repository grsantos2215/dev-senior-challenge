import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventoOutbox } from '@/application/entities/evento-outbox'
import { Injectable } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

import { CHECKIN_FINISHED_ROUTING_KEY } from '@/infra/messaging/rabbit-mq/checkin-events.publisher'

interface FinalizarCheckInRequest {
    checkinId: string
}

interface FinalizarCheckInResponse {
    checkIn: CheckIn
    eventoId: string | null
}

@Injectable()
export class FinalizarCheckIn {
    constructor(
        private checkInRepository: CheckInRepository,
        private auditoria: AuditoriaPort,
    ) {}

    async execute(
        request: FinalizarCheckInRequest,
    ): Promise<FinalizarCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkInRepository.findById(checkinId)

        if (!checkIn) throw new CheckInNotFound()

        const jaFinalizado = checkIn.finalizadoEm !== null
        const statusAnterior = checkIn.status

        checkIn.finalizado()

        if (jaFinalizado) {
            await this.checkInRepository.save(checkIn)
            return { checkIn, eventoId: null }
        }

        const eventoId = crypto.randomUUID()
        const occurredAt = new Date()

        const payload: Record<string, unknown> = {
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
            eventId: eventoId,
            occurredAt: occurredAt.toISOString(),
        }

        const outbox = EventoOutbox.criar({
            tipo: 'CHECKIN_FINALIZADO',
            routingKey: CHECKIN_FINISHED_ROUTING_KEY,
            payload,
            checkinId: checkIn.id,
            eventoId,
            occurredAt,
        })

        await this.checkInRepository.save(checkIn, [outbox])

        await this.auditoria.registrar(
            new RegistroAuditoria(
                'CHECKIN_STATUS_ALTERADO',
                {
                    de: statusAnterior,
                    para: checkIn.status,
                    transicao: 'finalizar',
                },
                checkIn.id,
                checkIn.pacienteId,
            ),
        )

        return { checkIn, eventoId }
    }
}