import { StatusAgendamento, StatusCheckin } from '@/generated/prisma/enums'
import { TransicaoInvalida } from '@/application/entities/errors/transicao-invalida'

import { Replace } from '@/helpers/replace'
import { randomUUID } from 'node:crypto'

export interface CheckInProps {
    status: StatusCheckin
    dataReferencia: Date

    pacienteId: string
    statusAgendamento: StatusAgendamento
    especialidade?: string | null
    medico?: string | null
    horario?: string | null

    iniciadoEm?: Date | null
    finalizadoEm?: Date | null

    criadoEm: Date
    atualizadoEm: Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PropsDeEntrada = Replace<
    CheckInProps,
    { criadoEm?: Date; atualizadoEm?: Date }
>

const TRANSICOES: Record<StatusCheckin, readonly StatusCheckin[]> = {
    AGUARDANDO: ['EM_ATENDIMENTO', 'CANCELADO'],
    EM_ATENDIMENTO: ['FINALIZADO', 'CANCELADO'],
    FINALIZADO: [],
    CANCELADO: [],
}

export class CheckIn {
    private _id: string
    private props: CheckInProps

    constructor(props: PropsDeEntrada) {
        this._id = randomUUID()

        const criadoEm = props.criadoEm ?? new Date()

        this.props = {
            ...props,
            especialidade: props.especialidade ?? null,
            medico: props.medico ?? null,
            horario: props.horario ?? null,
            iniciadoEm: props.iniciadoEm ?? null,
            finalizadoEm: props.finalizadoEm ?? null,
            criadoEm,
            atualizadoEm: props.atualizadoEm ?? criadoEm,
        }

        this.validar()
    }

    public static hidratar(id: string, props: PropsDeEntrada): CheckIn {
        if (!UUID.test(id))
            throw new Error(`id invalido para hidratação: ${id}`)

        const checkIn = new CheckIn(props)
        checkIn._id = id
        return checkIn
    }

    public get id() {
        return this._id
    }

    public toJSON() {
        return { id: this._id, ...this.props }
    }

    public set status(status: StatusCheckin) {
        if (status === this.props.status) return
        if (!TRANSICOES[this.props.status].includes(status))
            throw new Error(
                `Transição inválida de ${this.props.status} para ${status}`,
            )

        this.aplicar({ status })
    }

    public get status() {
        return this.props.status
    }

    public set dataReferencia(dataReferencia: Date) {
        this.aplicar({ dataReferencia })
    }

    public get dataReferencia() {
        return this.props.dataReferencia
    }

    public set pacienteId(pacienteId: string) {
        this.aplicar({ pacienteId })
    }

    public get pacienteId() {
        return this.props.pacienteId
    }

    public set statusAgendamento(statusAgendamento: StatusAgendamento) {
        this.aplicar({ statusAgendamento })
    }

    public get statusAgendamento() {
        return this.props.statusAgendamento
    }

    public set especialidade(especialidade: string | null | undefined) {
        this.aplicar({ especialidade: especialidade ?? null })
    }

    public get especialidade() {
        return this.props.especialidade
    }

    public set medico(medico: string | null | undefined) {
        this.aplicar({ medico: medico ?? null })
    }

    public get medico() {
        return this.props.medico
    }

    public set horario(horario: string | null | undefined) {
        this.aplicar({ horario: horario ?? null })
    }

    public get horario() {
        return this.props.horario
    }

    public iniciado() {
        if (this.props.iniciadoEm) return

        this.aplicar({
            iniciadoEm: new Date(),
            status: 'EM_ATENDIMENTO',
        })
    }

    public get iniciadoEm() {
        return this.props.iniciadoEm
    }

    public finalizado() {
        if (this.props.finalizadoEm) return

        if (!this.props.iniciadoEm)
            throw new TransicaoInvalida(
                this.props.status,
                'CheckIn não pode ser finalizado sem início',
            )

        this.aplicar({
            finalizadoEm: new Date(),
            status: 'FINALIZADO',
        })
    }

    public get finalizadoEm() {
        return this.props.finalizadoEm
    }

    public cancelar() {
        if (this.props.finalizadoEm) return

        this.aplicar({
            finalizadoEm: new Date(),
            status: 'CANCELADO',
        })
    }

    public get criadoEm() {
        return this.props.criadoEm
    }

    public atualizado() {
        this.aplicar({ atualizadoEm: new Date() })
    }

    public get atualizadoEm() {
        return this.props.atualizadoEm
    }

    private aplicar(mudancas: Partial<CheckInProps>): void {
        const anterior = { ...this.props }
        Object.assign(this.props, mudancas)

        try {
            this.validar(anterior.status)
        } catch (erro) {
            this.props = anterior
            throw erro
        }
    }

    private validar(statusAnterior: StatusCheckin = this.props.status): void {
        const { status, iniciadoEm, finalizadoEm } = this.props
        const temInicio = Boolean(iniciadoEm)
        const temFim = Boolean(finalizadoEm)

        switch (status) {
            case 'AGUARDANDO':
                if (temInicio || temFim)
                    throw this.transicaoInvalida(
                        statusAnterior,
                        'AGUARDANDO não aceita iniciadoEm nem finalizadoEm',
                    )
                break
            case 'EM_ATENDIMENTO':
                if (!temInicio)
                    throw this.transicaoInvalida(
                        statusAnterior,
                        'EM_ATENDIMENTO exige iniciadoEm',
                    )
                if (temFim)
                    throw this.transicaoInvalida(
                        statusAnterior,
                        'EM_ATENDIMENTO não aceita finalizadoEm',
                    )
                break
            case 'FINALIZADO':
                if (!temInicio || !temFim)
                    throw this.transicaoInvalida(
                        statusAnterior,
                        'FINALIZADO exige iniciadoEm e finalizadoEm',
                    )
                break
            case 'CANCELADO':
                if (!temFim)
                    throw this.transicaoInvalida(
                        statusAnterior,
                        'CANCELADO exige finalizadoEm',
                    )
                break
        }

        if (this.props.statusAgendamento === 'PRESENTE') {
            if (!this.props.especialidade)
                throw new Error(
                    'statusAgendamento PRESENTE exige especialidade',
                )
            if (!this.props.horario)
                throw new Error('statusAgendamento PRESENTE exige horario')
        }
    }

    private transicaoInvalida(
        statusAnterior: StatusCheckin,
        motivo: string,
    ): TransicaoInvalida {
        return new TransicaoInvalida(statusAnterior, motivo)
    }
}
