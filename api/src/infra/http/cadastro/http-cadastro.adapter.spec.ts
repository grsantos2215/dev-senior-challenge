import {
    CadastroIndisponivel,
    CadastroRateLimitado,
    PacienteNaoEncontrado,
} from '@/application/services/cadastro-de-paciente/errors'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConfigService } from '@nestjs/config'
import { HttpCadastroAdapter } from './http-cadastro.adapter'
import nock from 'nock'

const BASE = 'http://cadastro.test'
const CPF = '11111111111'

const config = {
    getOrThrow: () => BASE,
} as unknown as ConfigService

describe('HttpCadastroAdapter', () => {
    let sut: HttpCadastroAdapter

    beforeEach(() => {
        nock.cleanAll()
        nock.disableNetConnect()
        sut = new HttpCadastroAdapter(config)
    })

    afterEach(() => {
        nock.cleanAll()
        nock.enableNetConnect()
    })

    describe('sucesso', () => {
        it('mapeia nome e dataNascimento', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).reply(200, {
                cpf: CPF,
                nome: 'Ana Souza',
                dataNascimento: '1988-03-12',
            })

            const resultado = await sut.buscarPorCpf(CPF)

            expect(resultado).toEqual({
                nome: 'Ana Souza',
                dataNascimento: new Date('1988-03-12T00:00:00Z'),
            })
        })

        it('ancora a data em UTC, para não andar de dia com fuso', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).reply(200, {
                cpf: CPF,
                nome: 'Ana Souza',
                dataNascimento: '1988-03-12',
            })

            const { dataNascimento } = (await sut.buscarPorCpf(CPF))!

            expect(dataNascimento.toISOString()).toBe(
                '1988-03-12T00:00:00.000Z',
            )
        })

        it('usa o CPF da resposta, e não o do caminho', async () => {
            nock(BASE)
                .get(`/pacientes/${CPF}`)
                // Servico malformado devolve outro cpf; o nome ainda vale
                .reply(200, {
                    cpf: '99999999999',
                    nome: 'Ana Souza',
                    dataNascimento: '1988-03-12',
                })

            const resultado = await sut.buscarPorCpf(CPF)

            expect(resultado?.nome).toBe('Ana Souza')
        })
    })

    describe('erros', () => {
        it('404 vira PacienteNaoEncontrado', async () => {
            nock(BASE)
                .get(`/pacientes/${CPF}`)
                .reply(404, { erro: 'Paciente não encontrado' })

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                PacienteNaoEncontrado,
            )
        })

        it('429 vira CadastroRateLimitado com o Retry-After do serviço', async () => {
            nock(BASE)
                .get(`/pacientes/${CPF}`)
                .reply(
                    429,
                    { erro: 'Rate limit excedido' },
                    { 'Retry-After': '7' },
                )

            await expect(sut.buscarPorCpf(CPF)).rejects.toMatchObject({
                constructor: CadastroRateLimitado,
                retryAfterSegundos: 7,
            })
        })

        it('429 sem Retry-After cai no piso, em vez de NaN', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).reply(429)

            await expect(sut.buscarPorCpf(CPF)).rejects.toMatchObject({
                retryAfterSegundos: 10,
            })
        })

        it('503 vira CadastroIndisponivel', async () => {
            nock(BASE)
                .get(`/pacientes/${CPF}`)
                .reply(503, { erro: 'Serviço temporariamente indisponível' })

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                CadastroIndisponivel,
            )
        })

        it('500 também vira CadastroIndisponivel', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).reply(500, 'boom')

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                CadastroIndisponivel,
            )
        })

        it('rede caída vira CadastroIndisponivel, não erro cru do axios', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).replyWithError('ECONNREFUSED')

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                CadastroIndisponivel,
            )
        })

        it('timeout vira CadastroIndisponivel, e não fica pendurado', async () => {
            const rapido = new HttpCadastroAdapter(config, 50)

            nock(BASE)
                .get(`/pacientes/${CPF}`)
                .delayConnection(500)
                .reply(200, {
                    cpf: CPF,
                    nome: 'Ana Souza',
                    dataNascimento: '1988-03-12',
                })

            await expect(rapido.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                CadastroIndisponivel,
            )
        })

        it('preserva a causa original, para o log ter o detalhe', async () => {
            nock(BASE).get(`/pacientes/${CPF}`).replyWithError('ECONNREFUSED')

            const erro = await sut.buscarPorCpf(CPF).catch((e) => e)

            expect(erro.cause).toBeInstanceOf(Error)
        })

        it('404 e 429 são erros DIFERENTES, e não o mesmo "fora do ar"', async () => {
            // Sao caminhos de negocio distintos: 404 e definitivo, 429 volta
            // em N segundos. Colapsar os dois orienta a recepcao errado.
            nock(BASE).get(`/pacientes/${CPF}`).reply(404)
            const naoEncontrado = await sut.buscarPorCpf(CPF).catch((e) => e)

            nock(BASE)
                .get(`/pacientes/${CPF}`)
                .reply(429, {}, { 'Retry-After': '3' })
            const rateLimitado = await sut.buscarPorCpf(CPF).catch((e) => e)

            expect(naoEncontrado).not.toBeInstanceOf(CadastroRateLimitado)
            expect(rateLimitado).not.toBeInstanceOf(PacienteNaoEncontrado)
        })
    })

    describe('higiene', () => {
        it('uma chamada por cpf, sem retry implicito', async () => {
            const scope = nock(BASE).get(`/pacientes/${CPF}`).once().reply(503)

            await expect(sut.buscarPorCpf(CPF)).rejects.toBeInstanceOf(
                CadastroIndisponivel,
            )

            expect(scope.isDone()).toBe(true)
        })
    })
})
