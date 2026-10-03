import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { ConfigModule } from "@nestjs/config";
import { MessagingModule } from "./infra/messaging/messaging.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MessagingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
