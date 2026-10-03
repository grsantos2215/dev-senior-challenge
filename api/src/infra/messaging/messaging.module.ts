import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CheckinEventsPublisher,
  createRmqClient,
  RMQ_CLIENT,
} from "./rabbit-mq/checkin-events.publisher.js";

@Module({
  providers: [
    {
      provide: RMQ_CLIENT,
      useFactory: (config: ConfigService) => createRmqClient(config),
      inject: [ConfigService],
    },
    CheckinEventsPublisher,
  ],
  exports: [CheckinEventsPublisher],
})
export class MessagingModule {}