import { IsString, Matches } from 'class-validator'

import { REGEX_CPF } from './consulta-por-cpf.dto'

export class CreateCheckInDto {
    @IsString({ message: 'cpf deve ser uma string' })
    @Matches(REGEX_CPF, { message: 'cpf deve ter 11 dígitos' })
    cpf: string
}

export function hojeComoDataReferencia(agora: Date = new Date()): Date {
    return new Date(
        Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
    )
}
