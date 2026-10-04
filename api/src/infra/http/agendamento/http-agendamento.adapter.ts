import {
    Agendamento,
    AgendamentoPort,
} from '@/application/services/agendamento/agendamento.port'

import { ConfigService } from '@nestjs/config'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { HTTP_TIMEOUT_MS } from '@/infra/tokens/http-timeout'
import { RequestAgendamentos200Dto } from '@/infra/http/dtos/request-agendamentos'
import axios from 'axios'
import { convertXmlToJson } from '@/lib/xml-converter' 

/**
 * Adapter do legado XML de agendamento (porta 4100).
 *
 * Diferente do cadastro, aqui **não** há tri-state no adapter: o legado
 * responde `possuiAgendamento=false` para quem é walk-in, que é um caso
 * válido. Misturar "não tem agendamento" com "não deu para perguntar" seria
 * jogar fora exatamente a distinção que o ADR 4 comprou. Então:
 * - `null`  = o legado respondeu, e a resposta é não ter agendamento
 * - erro    = o legado falhou (500, timeout), e o chamador vira `INDISPONIVEL`
 *
 * Erro propositalmente genérico: quem chama degrade para `INDISPONIVEL` e não
 * precisa (não deve) distinguir "500" de "timeout". Retry está descartado no
 * ADR 4.
 */
@Injectable()
export class HttpAgendamentoAdapter extends AgendamentoPort {
    private readonly baseUrl: string

    constructor(
        config: ConfigService,
        // Ver `HTTP_TIMEOUT_MS`: o parametro com default gera metadata que o
        // Nest tenta resolver como provider.
        @Optional()
        @Inject(HTTP_TIMEOUT_MS)
        private readonly timeoutMs = 5_000,
    ) {
        super()
        this.baseUrl = config.getOrThrow<string>('AGENDAMENTO_URL')
    }

    async buscarPorCpf(cpf: string): Promise<Agendamento | null> {
        const xml = await this.buscarXml(cpf)
        const resposta = convertXmlToJson(xml) as RequestAgendamentos200Dto
        const dados = resposta?.AgendamentoResponse

        if (!dados) throw new ErroAgendamentoIndisponivel()

        if (typeof dados.possuiAgendamento !== 'boolean')
            throw new ErroAgendamentoIndisponivel()

        if (!dados.possuiAgendamento) return null

        if (!dados.especialidade || !dados.horario || !dados.medico) return null

        return {
            especialidade: dados.especialidade,
            horario: dados.horario,
            medico: dados.medico,
        }
    }

    private async buscarXml(cpf: string): Promise<string> {
        try {
            const { data } = await axios.get(this.baseUrl + '/agendamento', {
                params: { cpf },
                responseType: 'text',
                timeout: this.timeoutMs,
            })

            return data
        } catch (erro) {
            throw new ErroAgendamentoIndisponivel(erro)
        }
    }
}

export class ErroAgendamentoIndisponivel extends Error {
    constructor(cause?: unknown) {
        super('Agendamento legado indisponivel.', { cause })
    }
}
