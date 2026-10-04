import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable } from '@nestjs/common'

interface CancelarCheckInRequest {
    checkinId: string
}

interface CancelarCheckInResponse {
    checkIn: CheckIn
    eventoId: string | null
}

@Injectable()
export class CancelarCheckIn {
    constructor(
        private checkInRepository: CheckInRepository,
        private eventos: EventosDeCheckInPort,
    ) {}

    async execute(request: CancelarCheckInRequest): Promise<CancelarCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkInRepository.findById(checkinId)

        if (!checkIn) throw new CheckInNotFound()

        const jaEncerrado = checkIn.finalizadoEm !== null

        checkIn.cancelar()

        await this.checkInRepository.save(checkIn)

        if (jaEncerrado) return { checkIn, eventoId: null }

        const eventoId = this.eventos.publicarCheckinCancelado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return { checkIn, eventoId }
    }
}