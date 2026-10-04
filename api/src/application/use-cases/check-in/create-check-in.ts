import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { Injectable } from '@nestjs/common'

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
        private eventos: EventosDeCheckInPort,
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

        await this.checkInRepository.create(checkIn)

        const eventoId = this.eventos.publicarCheckinCriado({
            checkinId: checkIn.id,
            pacienteId: checkIn.pacienteId,
            status: checkIn.status,
        })

        return {
            checkIn,
            pacienteId: paciente.id,
            nome: paciente.nome,
            enriquecimentoPendente,
            eventoId,
        }
    }
}
