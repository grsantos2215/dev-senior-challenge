import { Paciente } from '@/application/entities/paciente'
import { Paciente as RawPaciente } from '@/generated/prisma/client' 

export class PrismaPacienteMapper {
    static toPrisma(paciente: Paciente): RawPaciente {
        return {
            id: paciente.id,
            cpf: paciente.cpf,
            nome: paciente.nome,
            dataNascimento: paciente.dataNascimento,
            criadoEm: paciente.criadoEm,
            atualizadoEm: paciente.atualizadoEm,
        }
    }

    static toPrismaAtualizacao(paciente: Paciente): {
        nome: string | null
        dataNascimento: Date | null
    } {
        return {
            nome: paciente.nome,
            dataNascimento: paciente.dataNascimento,
        }
    }

    static toDomain(raw: RawPaciente): Paciente {
        return Paciente.hidratar(raw.id, {
            cpf: raw.cpf,
            nome: raw.nome,
            dataNascimento: raw.dataNascimento,
            criadoEm: raw.criadoEm,
            atualizadoEm: raw.atualizadoEm,
        })
    }
}
