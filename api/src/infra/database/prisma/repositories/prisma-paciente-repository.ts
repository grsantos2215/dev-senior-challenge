import { Injectable } from '@nestjs/common'
import { Paciente } from '@/application/entities/paciente'
import { PacienteRepository } from '@/application/repositories/paciente-repository' 
import { PrismaPacienteMapper } from '@/infra/database/prisma/mappers/prisma-paciente-mapper'
import { PrismaService } from '@/infra/database/prisma/prisma.service'

@Injectable()
export class PrismaPacienteRepository implements PacienteRepository {
    constructor(private prisma: PrismaService) {}

    async create(paciente: Paciente): Promise<void> {
        await this.prisma.paciente.create({
            data: PrismaPacienteMapper.toPrisma(paciente),
        })
    }

    async findByCpf(cpf: string): Promise<Paciente | null> {
        const paciente = await this.prisma.paciente.findUnique({
            where: { cpf },
        })

        return paciente ? PrismaPacienteMapper.toDomain(paciente) : null
    }

    async findById(id: string): Promise<Paciente | null> {
        const paciente = await this.prisma.paciente.findUnique({
            where: { id },
        })

        return paciente ? PrismaPacienteMapper.toDomain(paciente) : null
    }

    async save(paciente: Paciente): Promise<void> {
        await this.prisma.paciente.update({
            where: { id: paciente.id },
            data: PrismaPacienteMapper.toPrismaAtualizacao(paciente),
        })
    }
}
