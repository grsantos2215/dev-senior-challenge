import { ConfigService } from '@nestjs/config'
import { DespacharOutbox } from '@/application/use-cases/outbox/despachar-outbox'
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '@/infra/database/prisma/prisma.service'

const INTERVAL_MS_PADRAO = 5_000
const LOTE_PADRAO = 20
const LOCK_OUTBOX_NAMESPACE = 1_362_371_401
const LOCK_OUTBOX_ID = 1
const LOCK_TIMEOUT_MS = 120_000

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(OutboxDispatcher.name)
    private readonly intervaloMs: number
    private readonly lote: number

    private interval: NodeJS.Timeout | null = null
    private executando = false

    constructor(
        private readonly despacharOutbox: DespacharOutbox,
        private readonly prisma: PrismaService,
        config: ConfigService,
    ) {
        this.intervaloMs =
            config.get<number>('OUTBOX_INTERVAL_MS') ?? INTERVAL_MS_PADRAO
        this.lote = config.get<number>('OUTBOX_LOTE') ?? LOTE_PADRAO
    }

    onModuleInit(): void {
        this.interval = setInterval(() => {
            void this.drenar()
        }, this.intervaloMs)

        void this.drenar()
    }

    async drenar(limite: number = this.lote): Promise<void> {
        if (this.executando) return
        this.executando = true

        try {
            await this.prisma.$transaction(
                async (tx) => {
                    const [lock] = await tx.$queryRaw<
                        Array<{ adquirido: boolean }>
                    >`SELECT pg_try_advisory_xact_lock(${LOCK_OUTBOX_NAMESPACE}, ${LOCK_OUTBOX_ID}) AS adquirido`

                    if (!lock?.adquirido) return

                    await this.despacharOutbox.executar(limite)
                },
                { timeout: LOCK_TIMEOUT_MS },
            )
        } catch (erro) {
            this.logger.error(
                'falha ao drenar a outbox',
                erro instanceof Error ? erro.stack : undefined,
            )
        } finally {
            this.executando = false
        }
    }

    onModuleDestroy(): void {
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
    }
}
