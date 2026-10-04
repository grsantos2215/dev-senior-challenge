/**
 * Port de saída para pedir o enriquecimento do cadastro fora do caminho da
 * request.
 *
 * Existe por causa do rate limit do mock: 5 req/10s **por IP**. Como o adapter
 * roda dentro do container, todo mundo compartilha um IP só, e o teto vale
 * para a API inteira, não por paciente.
 *
 * A fila não sobe esse teto — nada sobe. O que ela dá é tirar a chamada do
 * caminho da request e deixar UM consumidor ritmar as chamadas, que é a única
 * forma de respeitar o limite sem recusar paciente.
 *
 * A payload leva só o `pacienteId`, nunca o CPF. O ADR 3 proíbe dado pessoal
 * no broker, e o consumidor consegue ler o CPF do banco quando precisa.
 */
export abstract class EnriquecimentoDeCadastroPort {
    /**
     * `tentativa` comeca em 1 e o consumidor a incrementa no reenvio. Fica na
     * porta (e nao so no publisher) porque quem decide quando desistir e quem
     * enfileira: o consumidor. Sem o parametro na assinatura, ele so poderia
     * reenviar com o contador sempre em 1 e nunca pararia.
     */
    abstract enfileirar(pacienteId: string, tentativa?: number): Promise<void>
}