import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable } from '@nestjs/common'

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
    ) {}

    async execute(request: FinalizarCheckInRequest): Promise<FinalizarCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkInRepository.findById(checkinId)

        if (!checkIn) throw new CheckInNotFound()

        const jaFinalizado = checkIn.finalizadoEm !== null

        checkIn.finalizado()

        await this.checkInRepository.save(checkIn)

        if (jaFinalizado) return { checkIn, eventoId: null }

        const eventoId = this.eventos.publicarCheckinFinalizado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return { checkIn, eventoId }
    }
}