import { CheckInRepository } from '../../repositories/checkin-repository'
import { Injectable } from '@nestjs/common'

interface CountPacientCheckinsRequest {
    pacientId: string
}

interface CountPacientCheckinsResponse {
    count: number
}

@Injectable()
export class CountPacientCheckins {
    constructor(private checkinRepository: CheckInRepository) {}

    async execute(
        request: CountPacientCheckinsRequest,
    ): Promise<CountPacientCheckinsResponse> {
        const { pacientId } = request

        const count =
            await this.checkinRepository.countManyByPacienteId(pacientId)

        return { count }
    }
}
