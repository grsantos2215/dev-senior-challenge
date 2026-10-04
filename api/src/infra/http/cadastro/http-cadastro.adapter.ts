import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from '@/application/services/cadastro-de-paciente/errors'
import {
    CadastroPort,
    PacienteCadastrado,
} from '@/application/services/cadastro-de-paciente/cadastro.port'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { HTTP_TIMEOUT_MS } from '@/infra/tokens/http-timeout'
import { RequestPacientes200Dto } from '@/infra/http/dtos/request-pacientes'
import axios from 'axios'

/**
 * Adapter do mock REST de cadastro (porta 4000).
 *
 * Ele tem 12% de 503 e rate limit de 5 req/10s **por IP**. Se este adapter
 * roda dentro do container, todo mundo compartilha um IP só, então o 6º
 * paciente distinto em 10s toma 429. Por isso o rate limit é erro próprio e
 * não "indisponível": a diferença é se vale tentar de novo.
 */
@Injectable()
export class HttpCadastroAdapter extends CadastroPort {
    private readonly logger = new Logger(HttpCadastroAdapter.name)
    private readonly baseUrl: string

    constructor(
        config: ConfigService,
        @Optional()
        @Inject(HTTP_TIMEOUT_MS)
        private readonly timeoutMs = 5_000,
    ) {
        super()
        this.baseUrl = config.getOrThrow<string>('CADASTRO_URL')
    }

    async buscarPorCpf(cpf: string): Promise<PacienteCadastrado | null> {
        try {
            const { data } = await axios.get<RequestPacientes200Dto>(
                `${this.baseUrl}/pacientes/${cpf}`,
                { timeout: this.timeoutMs },
            )

            return {
                nome: data.nome,
                dataNascimento: new Date(`${data.dataNascimento}T00:00:00Z`),
            }
        } catch (erro) {
            throw this.classificar(erro, cpf)
        }
    }

    private classificar(erro: unknown, cpf: string): Error {
        if (axios.isAxiosError(erro)) {
            const status = erro.response?.status

            if (status === 404) return new PacienteNaoEncontrado(cpf)

            if (status === 429) {
                const retryAfter = Number(erro.response?.headers['retry-after'])
                return new CadastroRateLimitado(
                    Number.isFinite(retryAfter) ? retryAfter : 10,
                )
            }

            this.logger.warn(
                `cadastro respondeu ${status ?? 'sem resposta'} para cpf=${cpf}`,
            )
        } else {
            this.logger.warn(
                `cadastro falhou sem resposta HTTP para cpf=${cpf}`,
            )
        }

        return new CadastroIndisponivel(erro)
    }
}
