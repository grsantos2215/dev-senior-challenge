import { RegistroAuditoria } from '@/application/entities/registro-auditoria'
import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { Prisma } from '@/generated/prisma/client'

@Injectable()
export class PrismaAuditoriaRepository implements AuditoriaPort {
    private readonly logger = new Logger(PrismaAuditoriaRepository.name)

    constructor(private prisma: PrismaService) {}

    async registrar(registro: RegistroAuditoria): Promise<void> {
        try {
            await this.prisma.log.create({
                data: {
                    id: registro.id,
                    acao: registro.acao,
                    contexto: this.paraJson(registro.contexto),
                    checkinId: registro.checkinId,
                    pacienteId: registro.pacienteId,
                    ip: registro.ip,
                    hostname: registro.hostname,
                    criadoEm: registro.criadoEm,
                },
            })
        } catch (erro) {
            this.logger.error(
                `falha ao registrar auditoria acao=${registro.acao} checkinId=${registro.checkinId}: ${erro instanceof Error ? erro.constructor.name : erro}`,
            )
        }
    }

    private paraJson(
        contexto: Record<string, unknown> | null,
    ): Prisma.InputJsonValue {
        return (contexto ?? {}) as Prisma.InputJsonValue
    }

    async findManyByCheckIn(checkinId: string): Promise<RegistroAuditoria[]> {
        const logs = await this.prisma.log.findMany({
            where: { checkinId },
            orderBy: { criadoEm: 'asc' },
        })

        return logs.map((log) => this.paraDominio(log))
    }

    async findManyByPaciente(pacienteId: string): Promise<RegistroAuditoria[]> {
        const logs = await this.prisma.log.findMany({
            where: { pacienteId },
            orderBy: { criadoEm: 'asc' },
        })

        return logs.map((log) => this.paraDominio(log))
    }

    private paraDominio(log: {
        id: string
        acao: RegistroAuditoria['acao']
        contexto: unknown
        checkinId: string | null
        pacienteId: string | null
        ip: string | null
        hostname: string | null
        criadoEm: Date
    }): RegistroAuditoria {
        return new RegistroAuditoria(
            log.acao,
            (log.contexto as Record<string, unknown> | null) ?? null,
            log.checkinId,
            log.pacienteId,
            log.ip,
            log.hostname,
        )
    }
}
