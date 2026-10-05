import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventoOutbox } from '@/application/entities/evento-outbox'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { Injectable } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

import {
    CHECKIN_CREATED_ROUTING_KEY,
    CheckinCreatedEvent,
} from '@/infra/messaging/rabbit-mq/checkin-events.publisher'

interface CreateCheckInRequest {
    cpf: string
    dataReferencia: Date
}

interface CreateCheckInResponse {
    checkIn: CheckIn
    pacienteId: string
    nome: string | null
    enriquecimentoPendente: boolean
    eventoId: string
}

@Injectable()
export class CreateCheckIn {
    constructor(
        private checkInRepository: CheckInRepository,
        private getOrCreatePaciente: GetOrCreatePaciente,
        private auditoria: AuditoriaPort,
    ) {}

    async execute(
        request: CreateCheckInRequest,
    ): Promise<CreateCheckInResponse> {
        const { cpf, dataReferencia } = request

        const { paciente, enriquecimentoPendente } =
            await this.getOrCreatePaciente.execute({ cpf })

        const checkIn = new CheckIn({
            status: 'AGUARDANDO',
            dataReferencia,
            pacienteId: paciente.id,
            statusAgendamento: 'INDISPONIVEL',
        })

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
            tipo: 'CHECKIN_CRIADO',
            routingKey: CHECKIN_CREATED_ROUTING_KEY,
            payload,
            checkinId: checkIn.id,
            eventoId,
            occurredAt,
        })

        await this.checkInRepository.create(checkIn, [outbox])

        await this.auditoria.registrar(
            new RegistroAuditoria(
                'CHECKIN_CRIADO',
                {
                    status: checkIn.status,
                    statusAgendamento: checkIn.statusAgendamento,
                    enriquecimentoPendente,
                },
                checkIn.id,
                checkIn.pacienteId,
            ),
        )

        return {
            checkIn,
            pacienteId: paciente.id,
            nome: paciente.nome,
            enriquecimentoPendente,
            eventoId,
        }
    }
}