import { ConfigService } from '@nestjs/config'
import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common'
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib'

import { CHECKIN_EXCHANGE } from './rabbit-mq/fila'

@Injectable()
export class RabbitPublisher implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RabbitPublisher.name)

    private conexao: ChannelModel | null = null
    private channel: ConfirmChannel | null = null

    constructor(private readonly config: ConfigService) {}

    async onModuleInit(): Promise<void> {
        this.conexao = await connect(
            this.config.getOrThrow<string>('BROKER_URL'),
        )
        this.channel = await this.conexao.createConfirmChannel()
    }

    async onModuleDestroy(): Promise<void> {
        await this.channel?.close().catch(() => undefined)
        await this.conexao?.close().catch(() => undefined)
    }

    async publicar(routingKey: string, payload: unknown): Promise<void> {
        try {
            this.enviar(routingKey, payload)
        } catch (erro) {
            this.logger.error(
                `falha ao publicar ${routingKey}`,
                erro instanceof Error ? erro.stack : undefined,
            )
        }
    }

    async publicarOuFalhar(
        routingKey: string,
        payload: unknown,
    ): Promise<void> {
        this.enviar(routingKey, payload)
        await this.channel?.waitForConfirms()
    }

    private enviar(routingKey: string, payload: unknown): void {
        if (!this.channel) {
            throw new Error(
                'canal indisponivel: onModuleInit nao rodou ou a conexao caiu',
            )
        }

        this.channel.publish(
            CHECKIN_EXCHANGE,
            routingKey,
            Buffer.from(JSON.stringify({ pattern: routingKey, data: payload })),
            {
                persistent: true,
                contentType: 'application/json',
            },
        )
    }
}
