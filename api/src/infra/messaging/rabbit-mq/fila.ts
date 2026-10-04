import type { ConfirmChannel } from 'amqplib'

export const CHECKIN_EXCHANGE = 'checkin.events'

export const CADASTRO_ENRIQUECIMENTO_QUEUE = 'cadastro.enriquecer'
export const CADASTRO_ENRIQUECIMENTO_DLQ = 'cadastro.enriquecer.dlq'
export const CADASTRO_ENRIQUECIMENTO_ROUTING_KEY = 'cadastro.enriquecer'
export const CADASTRO_ENRIQUECIMENTO_DLQ_ROUTING_KEY = 'cadastro.enriquecer.dlq'

/**
 * Argumentos da fila principal.
 *
 * Fica exportado porque o broker exige que toda redeclaracao da fila traga
 * exatamente os mesmos argumentos: divergir da um 406 PRECONDITION_FAILED e
 * derruba o canal. O `ServerRMQ` declara a fila no startup, e a funcao abaixo
 * pode rodar depois, entao as duas pontas precisam ler daqui.
 */
export function opcoesFilaEnriquecimento() {
    return {
        durable: true,
        // Rejeitar sem volta: mensagem que o broker nao consegue entregar vai
        // para a DLQ em vez de ficar presa em loop de redelivery.
        deadLetterExchange: CHECKIN_EXCHANGE,
        deadLetterRoutingKey: CADASTRO_ENRIQUECIMENTO_DLQ_ROUTING_KEY,
    }
}

/**
 * Declara exchange, filas e bindings.
 *
 * Idempotente de proposito: `assert*` no broker falha apenas se a declaracao
 * conflitar com o que ja existe, entao subir duas instancias da API nao
 * quebra nada.
 *
 * Nao e o unico caminho: o `ServerRMQ` declara a fila principal sozinho no
 * startup, via `queueOptions` em `main.ts`. Precisa ser ele, porque
 * `queue.bind` e `queue.consume` exigem fila existente e o consumer comeca
 * antes de qualquer `onApplicationBootstrap`. Esta funcao cobre a DLQ, que
 * ninguem declara, e redeclara a principal com os mesmos argumentos.
 */
export async function declararTopologiaEnriquecimento(
    channel: ConfirmChannel,
): Promise<void> {
    await channel.assertExchange(CHECKIN_EXCHANGE, 'topic', { durable: true })

    await channel.assertQueue(CADASTRO_ENRIQUECIMENTO_DLQ, {
        durable: true,
        expires: 7 * 24 * 60 * 60 * 1000,
    })

    await channel.assertQueue(
        CADASTRO_ENRIQUECIMENTO_QUEUE,
        opcoesFilaEnriquecimento(),
    )

    await channel.bindQueue(
        CADASTRO_ENRIQUECIMENTO_QUEUE,
        CHECKIN_EXCHANGE,
        CADASTRO_ENRIQUECIMENTO_ROUTING_KEY,
    )

    await channel.bindQueue(
        CADASTRO_ENRIQUECIMENTO_DLQ,
        CHECKIN_EXCHANGE,
        CADASTRO_ENRIQUECIMENTO_DLQ_ROUTING_KEY,
    )
}
