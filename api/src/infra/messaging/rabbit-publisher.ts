import { ConfigService } from '@nestjs/config'
import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common'
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib'

import { CHECKIN_EXCHANGE } from './rabbit-mq/fila'

const INTERVALO_RECONEXAO_MS = 5_000

@Injectable()
export class RabbitPublisher implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RabbitPublisher.name)

    private conexao: ChannelModel | null = null
    private channel: ConfirmChannel | null = null
    private reconexao: NodeJS.Timeout | null = null
    private destruido = false
    private conectando = false

    constructor(private readonly config: ConfigService) {}

    async onModuleInit(): Promise<void> {
        await this.conectar()
    }

    async onModuleDestroy(): Promise<void> {
        this.destruido = true
        if (this.reconexao) {
            clearTimeout(this.reconexao)
            this.reconexao = null
        }
        await this.fecharCanal()
    }

    estaConectado(): boolean {
        return this.channel !== null
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

    private async conectar(): Promise<void> {
        if (this.destruido || this.conectando || this.channel) return
        this.conectando = true

        try {
            const conexao = await connect(
                this.config.getOrThrow<string>('BROKER_URL'),
            )
            const channel = await conexao.createConfirmChannel()

            conexao.on('error', (erro) => {
                this.logger.error(
                    'conexao com o broker caiu',
                    erro instanceof Error ? erro.stack : undefined,
                )
            })
            conexao.on('close', () => {
                this.conexao = null
                this.channel = null
                this.agendarReconexao()
            })
            channel.on('error', (erro) => {
                this.logger.error(
                    'canal do broker caiu',
                    erro instanceof Error ? erro.stack : undefined,
                )
            })
            channel.on('close', () => {
                this.channel = null
                this.agendarReconexao()
            })

            this.conexao = conexao
            this.channel = channel
        } catch (erro) {
            this.logger.error(
                'não consegui conectar no broker, vou tentar de novo',
                erro instanceof Error ? erro.stack : undefined,
            )
            this.agendarReconexao()
        } finally {
            this.conectando = false
        }
    }

    private agendarReconexao() {
        if (this.destruido || this.reconexao) return

        this.reconexao = setTimeout(() => {
            this.reconexao = null
            void this.conectar()
        }, INTERVALO_RECONEXAO_MS)

        this.reconexao.unref?.()
    }

    private async fecharCanal() {
        await this.channel?.close().catch(() => undefined)
        await this.conexao?.close().catch(() => undefined)
        this.channel = null
        this.conexao = null
    }
}
