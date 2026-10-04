import { CountPacientCheckins } from './count-pacient-checkins'
import { Injectable } from '@nestjs/common'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

interface CountCheckInsByCpfRequest {
    cpf: string
}

interface CountCheckInsByCpfResponse {
    count: number
    pacienteId: string
}

@Injectable()
export class CountCheckInsByCpf {
    constructor(
        private readonly pacientes: PacienteRepository,
        private readonly countByPaciente: CountPacientCheckins,
    ) {}

    async execute(
        request: CountCheckInsByCpfRequest,
    ): Promise<CountCheckInsByCpfResponse | null> {
        const { cpf } = request

        const paciente = await this.pacientes.findByCpf(cpf)

        if (!paciente) return null

        const { count } = await this.countByPaciente.execute({
            pacientId: paciente.id,
        })

        return { count, pacienteId: paciente.id }
    }
}
