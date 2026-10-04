import { CheckIn } from '@/application/entities/checkin'
import { CheckInJaAberto } from '@/application/use-cases/check-in/errors/check-in-ja-aberto'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaCheckInMapper } from '../mappers/prisma-checkin-mapper'
import { PrismaService } from '../prisma.service'

@Injectable()
export class PrismaCheckInRepository implements CheckInRepository {
    constructor(private prisma: PrismaService) {}

    async findById(id: string): Promise<CheckIn | null> {
        const checkIn = await this.prisma.checkin.findUnique({ where: { id } })

        if (!checkIn) return null

        return PrismaCheckInMapper.toDomain(checkIn)
    }

    async findManyByPacienteId(pacienteId: string): Promise<CheckIn[]> {
        const checkIns = await this.prisma.checkin.findMany({
            where: { pacienteId },
            orderBy: { criadoEm: 'desc' },
        })

        return checkIns.map((checkIn) => PrismaCheckInMapper.toDomain(checkIn))
    }

    async countManyByPacienteId(pacienteId: string): Promise<number> {
        return this.prisma.checkin.count({ where: { pacienteId } })
    }

    async create(checkIn: CheckIn): Promise<void> {
        const raw = PrismaCheckInMapper.toPrisma(checkIn)

        try {
            await this.prisma.checkin.create({
                data: raw,
            })
        } catch (erro) {
            throw this.tratarViolacaoDeUnicidade(erro, checkIn)
        }
    }

    private tratarViolacaoDeUnicidade(
        erro: unknown,
        checkIn: CheckIn,
    ): unknown {
        if (
            erro instanceof Prisma.PrismaClientKnownRequestError &&
            erro.code === 'P2002'
        )
            return new CheckInJaAberto(
                checkIn.pacienteId,
                checkIn.dataReferencia,
            )

        return erro
    }

    async save(checkIn: CheckIn): Promise<void> {
        const { id, ...dados } = PrismaCheckInMapper.toPrisma(checkIn)

        try {
            await this.prisma.checkin.updateMany({ where: { id }, data: dados })
        } catch (erro) {
            if (
                erro instanceof Prisma.PrismaClientKnownRequestError &&
                erro.code === 'P2025'
            )
                return

            throw erro
        }
    }
}
