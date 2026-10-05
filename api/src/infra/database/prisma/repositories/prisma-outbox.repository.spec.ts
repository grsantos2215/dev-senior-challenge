import { describe, expect, it, vi } from 'vitest'

import { MAX_TENTATIVAS_OUTBOX } from '@/application/services/outbox/limites-outbox'
import { PrismaOutboxRepository } from './prisma-outbox.repository'

describe('PrismaOutboxRepository', () => {
    it('não volta a selecionar eventos que atingiram o limite de tentativas', async () => {
        const findMany = vi.fn().mockResolvedValue([])
        const prisma = { outboxEvent: { findMany } }
        const repository = new PrismaOutboxRepository(prisma as never)

        await repository.listarNaoPublicados(20, MAX_TENTATIVAS_OUTBOX)

        expect(findMany).toHaveBeenCalledWith({
            where: {
                publicadoEm: null,
                tentativas: { lt: MAX_TENTATIVAS_OUTBOX },
            },
            orderBy: { criadoEm: 'asc' },
            take: 20,
        })
    })
})
