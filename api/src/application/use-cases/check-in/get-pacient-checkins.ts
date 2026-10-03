import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '../../repositories/checkin-repository'
import { Injectable } from '@nestjs/common'

interface ListCheckInsByPacienteRequest {
    pacientId: string
}

interface ListCheckInsByPacienteResponse {
    checkins: CheckIn[]
}

@Injectable()
export class ListCheckInsByPaciente {
    constructor(private checkinRepository: CheckInRepository) {}

    async execute(
        request: ListCheckInsByPacienteRequest,
    ): Promise<ListCheckInsByPacienteResponse> {
        const { pacientId } = request

        const checkins =
            await this.checkinRepository.findManyByPacienteId(pacientId)

        return { checkins }
    }
}
