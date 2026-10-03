import { CheckIn } from '@/application/entities/checkin'
import { Checkin as RawCheckIn } from '@/generated/prisma/client'

export class PrismaCheckInMapper {
    private static paraDate(horario: string | null | undefined): Date | null {
        if (!horario) return null

        const partes = /^(\d{1,2}):(\d{2})$/.exec(horario)
        if (!partes) throw new Error(`horario invalido: ${horario}`)

        const [, h, m] = partes
        if (+h > 23 || +m > 59)
            throw new Error(`horario fora de faixa: ${horario}`)

        return new Date(Date.UTC(1970, 0, 1, +h, +m, 0, 0))
    }

    private static paraTexto(horario: Date | null | undefined): string | null {
        if (!horario) return null

        const h = String(horario.getUTCHours()).padStart(2, '0')
        const m = String(horario.getUTCMinutes()).padStart(2, '0')

        return `${h}:${m}`
    }

    static toPrisma(checkIn: CheckIn): RawCheckIn {
        return {
            id: checkIn.id,
            pacienteId: checkIn.pacienteId,
            dataReferencia: checkIn.dataReferencia,
            status: checkIn.status,
            statusAgendamento: checkIn.statusAgendamento,
            especialidade: checkIn.especialidade ?? null,
            medico: checkIn.medico ?? null,
            horario: PrismaCheckInMapper.paraDate(checkIn.horario),
            iniciadoEm: checkIn.iniciadoEm ?? null,
            finalizadoEm: checkIn.finalizadoEm ?? null,
            criadoEm: checkIn.criadoEm,
            atualizadoEm: checkIn.atualizadoEm,
        }
    }

    static toDomain(raw: RawCheckIn): CheckIn {
        return CheckIn.hidratar(raw.id, {
            pacienteId: raw.pacienteId,
            dataReferencia: raw.dataReferencia,
            status: raw.status,
            statusAgendamento: raw.statusAgendamento,
            especialidade: raw.especialidade,
            medico: raw.medico,
            horario: PrismaCheckInMapper.paraTexto(raw.horario),
            iniciadoEm: raw.iniciadoEm,
            finalizadoEm: raw.finalizadoEm,
            criadoEm: raw.criadoEm,
            atualizadoEm: raw.atualizadoEm,
        })
    }
}
