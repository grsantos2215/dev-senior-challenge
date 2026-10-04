import { CheckIn } from '@/application/entities/checkin'
import { Injectable } from '@nestjs/common'
import { ListCheckInsByPaciente } from './get-pacient-checkins'
import { PacienteRepository } from '@/application/repositories/paciente-repository'

interface ListCheckInsByCpfRequest {
    cpf: string
}

interface ListCheckInsByCpfResponse {
    checkins: CheckIn[]
    pacienteId: string
}

@Injectable()
export class ListCheckInsByCpf {
    constructor(
        private readonly pacientes: PacienteRepository,
        private readonly listByPaciente: ListCheckInsByPaciente,
    ) {}

    async execute(
        request: ListCheckInsByCpfRequest,
    ): Promise<ListCheckInsByCpfResponse | null> {
        const { cpf } = request

        const paciente = await this.pacientes.findByCpf(cpf)

        if (!paciente) return null

        const { checkins } = await this.listByPaciente.execute({
            pacientId: paciente.id,
        })

        return { checkins, pacienteId: paciente.id }
    }
}
