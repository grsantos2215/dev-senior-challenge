import {
    Body,
    ConflictException,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
} from '@nestjs/common'
import { CancelarCheckIn } from '@/application/use-cases/check-in/cancelar-check-in'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import { CheckInNotFound } from '@/application/use-cases/check-in/errors/check-in-not-found'
import { ConsultaPorCpfDto } from './dto/consulta-por-cpf.dto'
import { CountCheckInsByCpf } from '@/application/use-cases/check-in/count-check-ins-by-cpf'
import { CreateCheckIn } from '@/application/use-cases/check-in/create-check-in'
import { FinalizarCheckIn } from '@/application/use-cases/check-in/finalizar-check-in'
import { GetCheckIn } from '@/application/use-cases/check-in/get-check-in'
import { ListCheckInsByCpf } from '@/application/use-cases/check-in/list-check-ins-by-cpf'
import { StartCheckIn } from '@/application/use-cases/check-in/start-check-in'
import { TransicaoInvalida } from '@/application/entities/errors/transicao-invalida'

import {
    CreateCheckInDto,
    hojeComoDataReferencia,
} from './dto/create-check-in.dto'

const checkinId = new ParseUUIDPipe({ version: '4' })

@Controller('check-ins')
export class CheckInController {
    constructor(
        private readonly createCheckIn: CreateCheckIn,
        private readonly getCheckIn: GetCheckIn,
        private readonly listCheckInsByCpf: ListCheckInsByCpf,
        private readonly countCheckInsByCpf: CountCheckInsByCpf,
        private readonly startCheckIn: StartCheckIn,
        private readonly finalizarCheckIn: FinalizarCheckIn,
        private readonly cancelarCheckIn: CancelarCheckIn,
    ) {}

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

    @Get()
    async listar(@Query() dto: ConsultaPorCpfDto) {
        const resultado = await this.listCheckInsByCpf.execute({
            cpf: dto.cpf,
        })

        if (!resultado) throw this.pacienteNaoEncontrado(dto.cpf)

        const { checkins, pacienteId } = resultado

        return {
            pacienteId,
            checkins: checkins.map((checkIn) => checkIn.toJSON()),
        }
    }

    @Get('contagem')
    async contar(@Query() dto: ConsultaPorCpfDto) {
        const resultado = await this.countCheckInsByCpf.execute({
            cpf: dto.cpf,
        })

        if (!resultado) throw this.pacienteNaoEncontrado(dto.cpf)

        return { pacienteId: resultado.pacienteId, count: resultado.count }
    }

    @Get(':checkinId')
    async buscar(@Param('checkinId', checkinId) id: string) {
        const { checkIn } = await this.getCheckIn.execute({ checkinId: id })

        if (!checkIn) throw this.paraHttp(new CheckInNotFound())

        return checkIn.toJSON()
    }

    @Post(':checkinId/iniciar')
    @HttpCode(HttpStatus.OK)
    async iniciar(@Param('checkinId', checkinId) id: string) {
        return this.transicao(async () => {
            const { checkIn, eventoId } = await this.startCheckIn.execute({
                checkinId: id,
            })

            return { ...checkIn.toJSON(), eventoId }
        })
    }

    @Post(':checkinId/finalizar')
    @HttpCode(HttpStatus.OK)
    async finalizar(@Param('checkinId', checkinId) id: string) {
        return this.transicao(async () => {
            const { checkIn, eventoId } = await this.finalizarCheckIn.execute({
                checkinId: id,
            })

            return { ...checkIn.toJSON(), eventoId }
        })
    }

    @Post(':checkinId/cancelar')
    @HttpCode(HttpStatus.OK)
    async cancelar(@Param('checkinId', checkinId) id: string) {
        return this.transicao(async () => {
            const { checkIn, eventoId } = await this.cancelarCheckIn.execute({
                checkinId: id,
            })

            return { ...checkIn.toJSON(), eventoId }
        })
    }

    private async transicao<T>(executar: () => Promise<T>): Promise<T> {
        try {
            return await executar()
        } catch (erro) {
            throw this.paraHttp(erro)
        }
    }

    private paraHttp(erro: unknown): Error {
        if (erro instanceof CheckInNotFound) {
            return new NotFoundException({ message: erro.message })
        }

        if (erro instanceof TransicaoInvalida) {
            return new ConflictException({
                message: erro.message,
                statusAtual: erro.statusAtual,
            })
        }

        return erro instanceof Error ? erro : new Error(String(erro))
    }

    private pacienteNaoEncontrado(_cpf: string): NotFoundException {
        return new NotFoundException({
            message: 'Nenhum paciente com o cpf informado.',
        })
    }
}
