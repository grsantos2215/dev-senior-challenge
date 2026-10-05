import {
    CHECKIN_CREATED_ROUTING_KEY,
    CheckinCreatedEvent,
} from '@/infra/messaging/rabbit-mq/checkin-events.publisher'
import { Injectable, Logger } from '@nestjs/common'

import { AgendamentoPort } from '@/application/services/agendamento/agendamento.port'
import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventoOutbox } from '@/application/entities/evento-outbox'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

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
    private readonly logger = new Logger(CreateCheckIn.name)

    constructor(
        private checkInRepository: CheckInRepository,
        private getOrCreatePaciente: GetOrCreatePaciente,
        private agendamento: AgendamentoPort,
        private auditoria: AuditoriaPort,
    ) {}

    async execute(
        request: CreateCheckInRequest,
    ): Promise<CreateCheckInResponse> {
        const { cpf, dataReferencia } = request

        const { paciente, enriquecimentoPendente } =
            await this.getOrCreatePaciente.execute({ cpf })

        const { statusAgendamento, agendamento } =
            await this.consultarAgendamento(cpf)

        const checkIn = new CheckIn({
            status: 'AGUARDANDO',
            dataReferencia,
            pacienteId: paciente.id,
            statusAgendamento,
            especialidade: agendamento?.especialidade ?? null,
            medico: agendamento?.medico ?? null,
            horario: agendamento?.horario ?? null,
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

    private async consultarAgendamento(cpf: string): Promise<{
        statusAgendamento: 'PRESENTE' | 'AUSENTE' | 'INDISPONIVEL'
        agendamento: {
            especialidade: string
            horario: string
            medico: string
        } | null
    }> {
        try {
            const agendamento = await this.agendamento.buscarPorCpf(cpf)

            if (!agendamento) {
                return { statusAgendamento: 'AUSENTE', agendamento: null }
            }

            return { statusAgendamento: 'PRESENTE', agendamento }
        } catch (erro) {
            this.logger.warn(
                `legado de agendamento indisponível: ${
                    erro instanceof Error ? erro.message : 'erro desconhecido'
                }`,
            )
            return { statusAgendamento: 'INDISPONIVEL', agendamento: null }
        }
    }
}
