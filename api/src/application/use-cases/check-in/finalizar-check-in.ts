import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

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
        private eventos: EventosDeCheckInPort,
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

        await this.checkInRepository.save(checkIn)

        if (jaFinalizado) return { checkIn, eventoId: null }

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

        const eventoId = this.eventos.publicarCheckinFinalizado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return { checkIn, eventoId }
    }
}
