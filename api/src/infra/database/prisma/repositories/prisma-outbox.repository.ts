import { EventoOutbox } from '@/application/entities/evento-outbox'
import { Injectable } from '@nestjs/common'
import { OutboxRepository } from '@/application/repositories/outbox-repository'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '../prisma.service'
import { MAX_TENTATIVAS_OUTBOX } from '@/application/services/outbox/limites-outbox'

@Injectable()
export class PrismaOutboxRepository implements OutboxRepository {
    constructor(private prisma: PrismaService) {}

    async criar(evento: EventoOutbox): Promise<void> {
        await this.prisma.outboxEvent.create({
            data: {
                id: evento.id,
                tipo: evento.tipo,
                routingKey: evento.routingKey,
                payload: evento.payload as Prisma.InputJsonValue,
                checkinId: evento.checkinId,
                tentativas: evento.tentativas,
                criadoEm: evento.criadoEm,
                publicadoEm: evento.publicadoEm,
            },
        })
    }

    async listarNaoPublicados(
        limite: number,
        maxTentativas: number,
    ): Promise<EventoOutbox[]> {
        const registros = await this.prisma.outboxEvent.findMany({
            where: {
                publicadoEm: null,
                tentativas: { lt: Math.min(maxTentativas, MAX_TENTATIVAS_OUTBOX) },
            },
            orderBy: { criadoEm: 'asc' },
            take: limite,
        })

        return registros.map((registro) =>
            EventoOutbox.hidratar(registro.id, {
                tipo: registro.tipo as any,
                routingKey: registro.routingKey,
                payload: registro.payload as Record<string, unknown>,
                checkinId: registro.checkinId,
                eventoId: registro.id,
                occurredAt: new Date(),
                tentativas: registro.tentativas,
                criadoEm: registro.criadoEm,
                publicadoEm: registro.publicadoEm,
            }),
        )
    }

    async salvar(evento: EventoOutbox): Promise<void> {
        await this.prisma.outboxEvent.update({
            where: { id: evento.id },
            data: {
                tentativas: evento.tentativas,
                publicadoEm: evento.publicadoEm,
            },
        })
    }
}
