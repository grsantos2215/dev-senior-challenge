import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientRMQ } from "@nestjs/microservices";
import { randomUUID } from "node:crypto";

import { CHECKIN_EXCHANGE } from "./fila";

export { CHECKIN_EXCHANGE };

export const CHECKIN_CREATED_ROUTING_KEY = "checkin.created";
export const RMQ_CLIENT = Symbol("RMQ_CLIENT");

export interface CheckinCreatedEvent {
  eventId: string;
  occurredAt: string;
  checkinId: string;
  pacienteId: string;
  status: string;
}

export function createRmqClient(config: ConfigService): ClientRMQ {
  return new ClientRMQ({
    urls: [config.getOrThrow<string>("BROKER_URL")],
    exchange: CHECKIN_EXCHANGE,
    exchangeType: "topic",
    wildcards: true,
    persistent: true,
  });
}

@Injectable()
export class CheckinEventsPublisher {
  private readonly logger = new Logger(CheckinEventsPublisher.name);

  constructor(@Inject(RMQ_CLIENT) private readonly client: ClientRMQ) {}

  emitCheckinCreated(
    input: Omit<CheckinCreatedEvent, "eventId" | "occurredAt">,
  ): string {
    const event: CheckinCreatedEvent = {
      ...input,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };

    this.client
      .emit(CHECKIN_CREATED_ROUTING_KEY, event)
      .subscribe({ error: (err: unknown) => this.logFailure(event, err) });

    return event.eventId;
  }

  private logFailure(event: CheckinCreatedEvent, err: unknown): void {
    this.logger.error(
      `falha ao publicar ${CHECKIN_CREATED_ROUTING_KEY} eventId=${event.eventId}`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}