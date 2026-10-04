import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '../../repositories/checkin-repository'
import { Injectable } from '@nestjs/common'

interface GetCheckInRequest {
    checkinId: string
}

interface GetCheckInResponse {
    checkIn: CheckIn | null
}

@Injectable()
export class GetCheckIn {
    constructor(private checkinRepository: CheckInRepository) {}

    async execute(request: GetCheckInRequest): Promise<GetCheckInResponse> {
        const { checkinId } = request

        const checkIn = await this.checkinRepository.findById(checkinId)

        return { checkIn }
    }
}
