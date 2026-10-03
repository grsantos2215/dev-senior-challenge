import { CheckIn } from '@/application/entities/checkin'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { Prisma } from '@/generated/prisma/client'
import { Injectable } from '@nestjs/common'
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

        await this.prisma.checkin.create({
            data: raw,
        })
    }

    /**
     * Update-only e silencioso quando a linha não existe, como no
     * `InMemoryNotificationsRepository`, que só substitui se achar o id.
     *
     * A paridade não é detalhe: um caso de uso testado contra o adapter em
     * memória faz no-op numa linha ausente, então o adapter de banco não pode
     * divergir — senão o teste passa e a produção quebra.
     *
     * `updateMany` não resolve sozinho: nesta versão do Prisma ele também lança
     * P2025 quando nada casa, então o no-op precisa ser explícito.
     */
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
