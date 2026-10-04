import { CancelarCheckIn } from '@/application/use-cases/check-in/cancelar-check-in'
import { CreateCheckIn } from '@/application/use-cases/check-in/create-check-in'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { CheckinEventsPublisher } from '../messaging/rabbit-mq/checkin-events.publisher'
import { CadastroModule } from '../cadastro/cadastro.module'
import { CheckInController } from '../http/check-in/check-in.controller'
import { DatabaseModule } from '../database/database.module'
import { FinalizarCheckIn } from '@/application/use-cases/check-in/finalizar-check-in'
import { MessagingModule } from '../messaging/messaging.module'
import { Module } from '@nestjs/common'
import { StartCheckIn } from '@/application/use-cases/check-in/start-check-in'

@Module({
    imports: [DatabaseModule, MessagingModule, CadastroModule],
    controllers: [CheckInController],
    providers: [
        CreateCheckIn,
        StartCheckIn,
        FinalizarCheckIn,
        CancelarCheckIn,
        {
            provide: EventosDeCheckInPort,
            useExisting: CheckinEventsPublisher,
        },
    ],
    exports: [CreateCheckIn, StartCheckIn, FinalizarCheckIn, CancelarCheckIn],
})
export class CheckInModule {}