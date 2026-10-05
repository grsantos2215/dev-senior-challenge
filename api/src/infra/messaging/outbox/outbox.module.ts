import { Module } from '@nestjs/common'
import { DatabaseModule } from '@/infra/database/database.module'
import { MessagingModule } from '@/infra/messaging/messaging.module'
import { PrismaOutboxRepository } from '@/infra/database/prisma/repositories/prisma-outbox.repository'
import { OutboxRepository } from '@/application/repositories/outbox-repository'
import { PublicadorDeEventosPort } from '@/application/services/outbox/publicador-de-eventos.port'
import { RabbitPublicadorDeEventosAdapter } from '@/infra/messaging/rabbit-mq/rabbit-publicador.adapter'
import { DespacharOutbox } from '@/application/use-cases/outbox/despachar-outbox'
import { OutboxDispatcher } from './outbox-dispatcher'

@Module({
  imports: [DatabaseModule, MessagingModule],
  providers: [
    {
      provide: OutboxRepository,
      useClass: PrismaOutboxRepository,
    },
    {
      provide: PublicadorDeEventosPort,
      useClass: RabbitPublicadorDeEventosAdapter,
    },
    DespacharOutbox,
    OutboxDispatcher,
  ],
  exports: [DespacharOutbox],
})
export class OutboxModule {}
