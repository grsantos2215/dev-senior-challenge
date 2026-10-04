import { Replace } from '@/helpers/replace'
import { randomUUID } from 'node:crypto'

export interface PacienteProps {
    cpf: string
    nome: string | null
    dataNascimento: Date | null

    criadoEm: Date
    atualizadoEm: Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CPF = /^\d{11}$/

type PropsDeEntrada = Replace<
    PacienteProps,
    {
        nome?: string | null
        dataNascimento?: Date | null
        criadoEm?: Date
        atualizadoEm?: Date
    }
>

export class Paciente {
    private _id: string
    private props: PacienteProps

    constructor(props: PropsDeEntrada) {
        this._id = randomUUID()

        const criadoEm = props.criadoEm ?? new Date()

        this.props = {
            ...props,
            nome: props.nome ?? null,
            dataNascimento: props.dataNascimento ?? null,
            criadoEm,
            atualizadoEm: props.atualizadoEm ?? criadoEm,
        }

        this.validar()
    }

    public static hidratar(id: string, props: PropsDeEntrada): Paciente {
        if (!UUID.test(id))
            throw new Error(
                `id inválido para hidratação: precisa ser UUID, recebido ${id}`,
            )

        const paciente = new Paciente(props)
        paciente._id = id

        return paciente
    }

    public get id() {
        return this._id
    }

    public toJSON() {
        return {
            id: this._id,
            ...this.props,
        }
    }

    public set nome(nome: string | null | undefined) {
        this.aplicar({ nome: nome ?? null })
    }

    public get nome(): string | null {
        return this.props.nome
    }

    public set dataNascimento(dataNascimento: Date | null | undefined) {
        this.aplicar({ dataNascimento: dataNascimento ?? null })
    }

    public get dataNascimento(): Date | null {
        return this.props.dataNascimento
    }

    public get cpf() {
        return this.props.cpf
    }

    public get criadoEm() {
        return this.props.criadoEm
    }

    public get atualizadoEm() {
        return this.props.atualizadoEm
    }

    private validar(): void {
        if (!UUID.test(this._id))
            throw new Error('Paciente.id precisa ser UUID')

        if (!CPF.test(this.props.cpf))
            throw new Error('Paciente.cpf precisa ter 11 digitos')

        if (this.props.nome !== null && this.props.nome.trim() === '')
            throw new Error('Paciente.nome não pode ser string vazia')
    }

    /**
     * `nome === null` é o sinal de que o cadastro ainda não foi confirmado: o
     * paciente entrou só com o CPF porque a integração de cadastro falhou.
     * Não derive isso de `nome` estar vazio — as duas coisas não são o mesmo.
     */
    public get cadastroConfirmado(): boolean {
        return this.props.nome !== null
    }

    private aplicar(mudancas: Partial<PacienteProps>): void {
        const anterior = { ...this.props }
        Object.assign(this.props, mudancas)

        try {
            this.validar()
        } catch (erro) {
            this.props = anterior
            throw erro
        }
    }
}
