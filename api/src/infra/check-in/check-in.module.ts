import { CancelarCheckIn } from '@/application/use-cases/check-in/cancelar-check-in'
import { CountCheckInsByCpf } from '@/application/use-cases/check-in/count-check-ins-by-cpf'
import { CountPacientCheckins } from '@/application/use-cases/check-in/count-pacient-checkins'
import { CreateCheckIn } from '@/application/use-cases/check-in/create-check-in'
import { EventosDeCheckInPort } from '@/application/services/check-in/eventos-de-check-in.port'
import { CheckinEventsPublisher } from '../messaging/rabbit-mq/checkin-events.publisher'
import { CadastroModule } from '../cadastro/cadastro.module'
import { CheckInController } from '../http/check-in/check-in.controller'
import { DatabaseModule } from '../database/database.module'
import { FinalizarCheckIn } from '@/application/use-cases/check-in/finalizar-check-in'
import { GetCheckIn } from '@/application/use-cases/check-in/get-check-in'
import { ListCheckInsByCpf } from '@/application/use-cases/check-in/list-check-ins-by-cpf'
import { ListCheckInsByPaciente } from '@/application/use-cases/check-in/get-pacient-checkins'
import { MessagingModule } from '../messaging/messaging.module'
import { Module } from '@nestjs/common'
import { StartCheckIn } from '@/application/use-cases/check-in/start-check-in'
import { AgendamentoPort } from '@/application/services/agendamento/agendamento.port'
import { HttpAgendamentoAdapter } from '../http/agendamento/http-agendamento.adapter'

@Module({
    imports: [DatabaseModule, MessagingModule, CadastroModule],
    controllers: [CheckInController],
    providers: [
        CreateCheckIn,
        StartCheckIn,
        FinalizarCheckIn,
        CancelarCheckIn,
        GetCheckIn,
        ListCheckInsByPaciente,
        CountPacientCheckins,
        ListCheckInsByCpf,
        CountCheckInsByCpf,
        {
            provide: AgendamentoPort,
            useClass: HttpAgendamentoAdapter,
        },
        {
            provide: EventosDeCheckInPort,
            useExisting: CheckinEventsPublisher,
        },
    ],
    exports: [
        CreateCheckIn,
        StartCheckIn,
        FinalizarCheckIn,
        CancelarCheckIn,
        GetCheckIn,
        ListCheckInsByPaciente,
        CountPacientCheckins,
        ListCheckInsByCpf,
        CountCheckInsByCpf,
    ],
})
export class CheckInModule {}
