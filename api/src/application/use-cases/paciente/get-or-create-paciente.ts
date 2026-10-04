import { Injectable, Logger } from '@nestjs/common'

import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { Paciente } from '@/application/entities/paciente'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

interface GetOrCreatePacienteRequest {
    cpf: string
}

interface GetOrCreatePacienteResponse {
    paciente: Paciente
    /**
     * `true` quando o nome ainda não chegou do cadastro e foi pedido por
     * fila. Não é falha: é o estado normal do primeiro check-in, porque a
     * consulta ao mock saiu do caminho da request para caber no rate limit.
     */
    enriquecimentoPendente: boolean
}

@Injectable()
export class GetOrCreatePaciente {
    private readonly logger = new Logger(GetOrCreatePaciente.name)

    constructor(
        private pacienteRepository: PacienteRepository,
        private enriquecimento: EnriquecimentoDeCadastroPort,
    ) {}

    async execute(
        request: GetOrCreatePacienteRequest,
    ): Promise<GetOrCreatePacienteResponse> {
        const { cpf } = request

        const local = await this.pacienteRepository.findByCpf(cpf)

        if (local?.cadastroConfirmado)
            return { paciente: local, enriquecimentoPendente: false }

        const paciente = local ?? (await this.criarDegradado(cpf))

        await this.pedirEnriquecimento(paciente.id)

        return { paciente, enriquecimentoPendente: true }
    }

    private async pedirEnriquecimento(pacienteId: string): Promise<void> {
        try {
            await this.enriquecimento.enfileirarSemBloquear(pacienteId)
        } catch (erro) {
            this.logger.warn(
                `enriquecimento de pacienteId=${pacienteId} não enfileirou: ${(erro as Error).message}`,
            )
        }
    }

    private async criarDegradado(cpf: string): Promise<Paciente> {
        const paciente = new Paciente({ cpf })

        await this.pacienteRepository.create(paciente)

        return paciente
    }
}
