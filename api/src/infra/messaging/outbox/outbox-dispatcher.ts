import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { DespacharOutbox } from '@/application/use-cases/outbox/despachar-outbox'

const INTERVAL_MS = 5000
const LOTE_PADRAO = 10

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | null = null
  private executando = false

  constructor(private readonly despacharOutbox: DespacharOutbox) {}

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.drenar()
    }, INTERVAL_MS)
  }

  async drenar(limite: number = LOTE_PADRAO) {
    if (this.executando) return
    this.executando = true
    try {
      await this.despacharOutbox.executar(limite)
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
