export interface Agendamento {
    especialidade: string
    horario: string
    medico: string
}

/**
 * Port de saída para o agendamento do legado (XML).
 *
 * O ADR 4 já decidiu: quem chama trata falha como `INDISPONIVEL` e não faz
 * retry. O porquê do retry estar descartado está no ADR — converter 10% de
 * falha em latência pior para todo mundo.
 *
 * Não há `AgendamentoIndisponivel` aqui de propósito: indistinguível de
 * "não tem agendamento" é exatamente o que o tri-state resolveu, e o legado
 * responde `possuiAgendamento=false` para o walk-in, que é um caso real.
 * Então: `null` é resposta válida e negative; erro é só para o legado ter
 * falhado de verdade.
 */
export abstract class AgendamentoPort {
    abstract buscarPorCpf(cpf: string): Promise<Agendamento | null>
}
