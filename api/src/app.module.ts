import { Module } from '@nestjs/common'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from '@nestjs/config'
import { CadastroModule } from './infra/cadastro/cadastro.module'
import { CheckInModule } from './infra/check-in/check-in.module'
import { DatabaseModule } from './infra/database/database.module'
import { MessagingModule } from './infra/messaging/messaging.module'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        MessagingModule,
        DatabaseModule,
        CadastroModule,
        CheckInModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
