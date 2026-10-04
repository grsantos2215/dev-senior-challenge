import { CreateCheckIn } from '@/application/use-cases/check-in/create-check-in'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import {
    Body,
    ConflictException,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
} from '@nestjs/common'

import {
    CreateCheckInDto,
    hojeComoDataReferencia,
} from './dto/create-check-in.dto'

@Controller('check-ins')
export class CheckInController {
    constructor(private readonly createCheckIn: CreateCheckIn) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async criar(@Body() dto: CreateCheckInDto) {
        try {
            const {
                checkIn,
                pacienteId,
                nome,
                enriquecimentoPendente,
                eventoId,
            } = await this.createCheckIn.execute({
                cpf: dto.cpf,
                dataReferencia: hojeComoDataReferencia(),
            })

            return {
                ...checkIn.toJSON(),
                pacienteId,
                nome,
                enriquecimentoPendente,
                eventoId,
            }
        } catch (erro) {
            if (erro instanceof CheckInJaAberto) {
                throw new ConflictException({
                    message: erro.message,
                    pacienteId: erro.pacienteId,
                    dataReferencia: erro.dataReferencia
                        .toISOString()
                        .slice(0, 10),
                })
            }

            throw erro
        }
    }
}
