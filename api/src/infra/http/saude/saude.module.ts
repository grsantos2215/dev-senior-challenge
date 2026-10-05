import {
    CHEGAGENS_DE_DEPENDENCIA,
    ChecagemDeDependencia,
    SaudeService,
} from '@/application/services/saude/saude.service'

import { ChecagemDoBanco } from '@/infra/database/prisma/checagens/checagem-do-banco'
import { ChecagemDoBroker } from '@/infra/messaging/checagens/checagem-do-broker'
import { DatabaseModule } from '@/infra/database/database.module'
import { MessagingModule } from '@/infra/messaging/messaging.module'
import { Module } from '@nestjs/common'
import { SaudeController } from './saude.controller'

@Module({
    imports: [DatabaseModule, MessagingModule],
    controllers: [SaudeController],
    providers: [
        ChecagemDoBanco,
        ChecagemDoBroker,
        {
            provide: CHEGAGENS_DE_DEPENDENCIA,
            useFactory: (...checagens: ChecagemDeDependencia[]) => checagens,
            inject: [ChecagemDoBanco, ChecagemDoBroker],
        },
        {
            provide: SaudeService,
            useFactory: (checagens: ChecagemDeDependencia[]) =>
                new SaudeService(checagens),
            inject: [CHEGAGENS_DE_DEPENDENCIA],
        },
    ],
})
export class SaudeModule {}
