import { describe, expect, it, vi } from 'vitest'

import { ConfigService } from '@nestjs/config'
import { DespacharOutbox } from '@/application/use-cases/outbox/despachar-outbox'
import { OutboxDispatcher } from './outbox-dispatcher'
import { PrismaService } from '@/infra/database/prisma/prisma.service'

function criarDispatcher(adquirido: boolean) {
    const executar = vi.fn<DespacharOutbox['executar']>()
    const queryRaw = vi.fn().mockResolvedValue([{ adquirido }])
    const transacao = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({ $queryRaw: queryRaw }),
    )
    const prisma = { $transaction: transacao } as unknown as PrismaService
    const config = {
        get: () => undefined,
    } as unknown as ConfigService
    const dispatcher = new OutboxDispatcher(
        { executar } as unknown as DespacharOutbox,
        prisma,
        config,
    )

    return { dispatcher, executar, queryRaw, transacao }
}

describe('OutboxDispatcher', () => {
    it('drena o lote quando adquire o lock distribuído', async () => {
        const { dispatcher, executar, queryRaw, transacao } =
            criarDispatcher(true)

        await dispatcher.drenar(7)

        expect(queryRaw).toHaveBeenCalledOnce()
        expect(executar).toHaveBeenCalledWith(7)
        expect(transacao).toHaveBeenCalledWith(expect.any(Function), {
            timeout: 120_000,
        })
    })

    it('não drena quando outra instância já tem o lock', async () => {
        const { dispatcher, executar, queryRaw } = criarDispatcher(false)

        await dispatcher.drenar()

        expect(queryRaw).toHaveBeenCalledOnce()
        expect(executar).not.toHaveBeenCalled()
    })
})
