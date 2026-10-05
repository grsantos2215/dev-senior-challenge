import { Module } from '@nestjs/common'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { CadastroModule } from './infra/cadastro/cadastro.module'
import { CheckInModule } from './infra/check-in/check-in.module'
import { OutboxModule } from './infra/messaging/outbox/outbox.module'
import { ConfigModule } from '@nestjs/config'
import { MessagingModule } from './infra/messaging/messaging.module'
import { SaudeModule } from './infra/http/saude/saude.module'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        MessagingModule,
        CadastroModule,
        CheckInModule,
        OutboxModule,
        SaudeModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
