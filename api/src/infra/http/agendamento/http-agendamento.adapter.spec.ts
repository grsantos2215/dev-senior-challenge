import {
    ErroAgendamentoIndisponivel,
    HttpAgendamentoAdapter,
} from './http-agendamento.adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConfigService } from '@nestjs/config'
import nock from 'nock'

const BASE = 'http://legado.test'
const CPF = '11111111111'

const config = {
    getOrThrow: () => BASE,
} as unknown as ConfigService

const xml = (corpo: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<AgendamentoResponse>\n  <cpf>${CPF}</cpf>\n${corpo}\n</AgendamentoResponse>`

describe('HttpAgendamentoAdapter', () => {
    let sut: HttpAgendamentoAdapter

    beforeEach(() => {
        nock.cleanAll()
        nock.disableNetConnect()
        sut = new HttpAgendamentoAdapter(config)
    })

    afterEach(() => {
        nock.cleanAll()
        nock.enableNetConnect()
    })

    describe('resposta com agendamento', () => {
        it('mapeia especialidade, horario e medico', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    xml(`  <possuiAgendamento>true</possuiAgendamento>
  <especialidade>Cardiologia</especialidade>
  <horario>09:30</horario>
  <medico>Dr. Prado</medico>`),
                    { 'Content-Type': 'application/xml' },
                )

            const resultado = await sut.buscarPorCpf(CPF)

            expect(resultado).toEqual({
                especialidade: 'Cardiologia',
                horario: '09:30',
                medico: 'Dr. Prado',
            })
        })

        it('manda o cpf por querystring, que é o jeito do legado', async () => {
            const scope = nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    xml('  <possuiAgendamento>false</possuiAgendamento>'),
                )

            await sut.buscarPorCpf(CPF)

            expect(scope.isDone()).toBe(true)
        })

        it('trata XML malformado como indisponível, e não como vazio', async () => {
            // Devolver null aqui seria pior que falhar: null significa
            // "o legado respondeu e não tem agendamento"
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(200, '<AgendamentoResponse><cpf>11111111111</cpf>')

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                ErroAgendamentoIndisponivel,
            )
        })
    })

    describe('resposta sem agendamento', () => {
        it('devolve null para o walk-in', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    xml('  <possuiAgendamento>false</possuiAgendamento>'),
                )

            expect(await sut.buscarPorCpf(CPF)).toBeNull()
        })

        it('devolve null se disser true mas vier sem os campos', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    xml('  <possuiAgendamento>true</possuiAgendamento>'),
                )

            expect(await sut.buscarPorCpf(CPF)).toBeNull()
        })
    })

    describe('falhas do legado', () => {
        it('500 vira ErroAgendamentoIndisponivel', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(500, 'erro')

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                ErroAgendamentoIndisponivel,
            )
        })

        it('500 não vira null, porque null significa walk-in', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(500, 'erro')

            const resultado = await sut.buscarPorCpf(CPF).catch(() => 'erro')

            expect(resultado).not.toBeNull()
        })

        it('timeout vira erro, e não null', async () => {
            const rapido = new HttpAgendamentoAdapter(config, 50)

            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .delayConnection(500)
                .reply(
                    200,
                    xml('  <possuiAgendamento>false</possuiAgendamento>'),
                )

            await expect(rapido.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                ErroAgendamentoIndisponivel,
            )
        })

        it('rede caída vira erro', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .replyWithError('ECONNREFUSED')

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                ErroAgendamentoIndisponivel,
            )
        })
    })

    describe('distinção que o ADR 4 comprou', () => {
        it('"não tem agendamento" e "não deu para perguntar" são valores diferentes', async () => {
            nock(BASE)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    xml('  <possuiAgendamento>false</possuiAgendamento>'),
                )
            const walkIn = await sut.buscarPorCpf(CPF).catch(() => 'erro')

            nock(BASE).get('/agendamento').query({ cpf: CPF }).reply(500)
            const caiu = await sut.buscarPorCpf(CPF).catch(() => 'erro')

            expect(walkIn).toBeNull()
            expect(caiu).not.toBeNull()
        })
    })
})
