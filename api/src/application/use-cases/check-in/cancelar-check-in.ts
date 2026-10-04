import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

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
        private auditoria: AuditoriaPort,
    ) {}

    async execute(
        request: CancelarCheckInRequest,
    ): Promise<CancelarCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkInRepository.findById(checkinId)

        if (!checkIn) throw new CheckInNotFound()

        const jaEncerrado = checkIn.finalizadoEm !== null
        const statusAnterior = checkIn.status

        checkIn.cancelar()

        await this.checkInRepository.save(checkIn)

        if (jaEncerrado) return { checkIn, eventoId: null }

        await this.auditoria.registrar(
            new RegistroAuditoria(
                'CHECKIN_STATUS_ALTERADO',
                {
                    de: statusAnterior,
                    para: checkIn.status,
                    transicao: 'cancelar',
                },
                checkIn.id,
                checkIn.pacienteId,
            ),
        )

        const eventoId = this.eventos.publicarCheckinCancelado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return { checkIn, eventoId }
    }
}
