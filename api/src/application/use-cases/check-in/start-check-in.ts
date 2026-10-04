import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckIn } from '@/application/entities/checkin'
import { CheckInNotFound } from './errors/check-in-not-found'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { Injectable } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

interface StartCheckInRequest {
    checkinId: string
}

interface StartCheckInResponse {
    checkIn: CheckIn
    eventoId: string | null
}

@Injectable()
export class StartCheckIn {
    constructor(
        private checkInRepository: CheckInRepository,
        private eventos: EventosDeCheckInPort,
        private auditoria: AuditoriaPort,
    ) {}

    async execute(request: StartCheckInRequest): Promise<StartCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkInRepository.findById(checkinId)

        if (!checkIn) throw new CheckInNotFound()

        const jaIniciado = checkIn.iniciadoEm !== null
        const statusAnterior = checkIn.status

        checkIn.iniciado()

        await this.checkInRepository.save(checkIn)

        if (jaIniciado) return { checkIn, eventoId: null }

        await this.auditoria.registrar(
            new RegistroAuditoria(
                'CHECKIN_STATUS_ALTERADO',
                {
                    de: statusAnterior,
                    para: checkIn.status,
                    transicao: 'iniciar',
                },
                checkIn.id,
                checkIn.pacienteId,
            ),
        )

        const eventoId = this.eventos.publicarCheckinIniciado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return { checkIn, eventoId }
    }
}
