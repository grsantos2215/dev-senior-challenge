import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { Injectable, Logger } from '@nestjs/common'
import { OutboxRepository } from '@/application/repositories/outbox-repository'
import { PublicadorDeEventosPort } from '@/application/services/outbox/publicador-de-eventos.port'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

const MAX_TENTATIVAS = 10

@Injectable()
export class DespacharOutbox {
    private readonly logger = new Logger(DespacharOutbox.name)

    constructor(
        private readonly outbox: OutboxRepository,
        private readonly publicador: PublicadorDeEventosPort,
        private readonly auditoria: AuditoriaPort,
    ) {}

    async executar(limite = 20): Promise<void> {
        const eventos = await this.outbox.listarNaoPublicados(limite)

        for (const evento of eventos) {
            try {
                await this.publicador.publicar(evento.routingKey, evento.payload)

                evento.marcarPublicado()
                await this.outbox.salvar(evento)

                await this.auditoria.registrar(
                    new RegistroAuditoria(
                        'OUTBOX_PUBLICADO',
                        {
                            tipo: evento.tipo,
                            routingKey: evento.routingKey,
                            eventoId: evento.id,
                        },
                        evento.checkinId,
                    ),
                )
            } catch (erro) {
                evento.marcarTentativa()
                await this.outbox.salvar(evento)

                this.logger.error(
                    `falha ao despachar outbox ${evento.id}`,
                    erro instanceof Error ? erro.stack : undefined,
                )

                if (evento.tentativas >= MAX_TENTATIVAS) {
                    await this.auditoria.registrar(
                        new RegistroAuditoria(
                            'OUTBOX_DESISTIDO',
                            {
                                tipo: evento.tipo,
                                routingKey: evento.routingKey,
                                eventoId: evento.id,
                                tentativas: evento.tentativas,
                            },
                            evento.checkinId,
                        ),
                    )
                }
            }
        }
    }
}