import { IsString, Matches } from 'class-validator'

export const REGEX_CPF = /^\d{11}$/

export class ConsultaPorCpfDto {
    @IsString({ message: 'cpf deve ser uma string' })
    @Matches(REGEX_CPF, { message: 'cpf deve ter 11 dígitos' })
    cpf: string
}
