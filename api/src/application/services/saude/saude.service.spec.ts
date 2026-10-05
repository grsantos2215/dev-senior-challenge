import { ChecagemDeDependencia, SaudeService } from './saude.service'
import { describe, expect, it } from 'vitest'

function saudavel(nome: string): ChecagemDeDependencia {
    return {
        nome,
        verificar: async () => undefined,
    }
}

function quebrado(nome: string): ChecagemDeDependencia {
    return {
        nome,
        verificar: async () => {
            throw new Error('canal do broker indisponível')
        },
    }
}

describe('SaudeService', () => {
    it('reporta ok quando todas as dependências respondem', async () => {
        const sut = new SaudeService([
            saudavel('postgres'),
            saudavel('rabbitmq'),
        ])

        await expect(sut.verificar()).resolves.toEqual({
            status: 'ok',
            dependencias: [
                { nome: 'postgres', saudavel: true },
                { nome: 'rabbitmq', saudavel: true },
            ],
        })
    })

    it('reporta degradado e diz qual dependencia caiu', async () => {
        const sut = new SaudeService([
            saudavel('postgres'),
            quebrado('rabbitmq'),
        ])

        const relatorio = await sut.verificar()

        expect(relatorio.status).toBe('degradado')
        expect(relatorio.dependencias).toEqual([
            { nome: 'postgres', saudavel: true },
            {
                nome: 'rabbitmq',
                saudavel: false,
                detalhe: 'canal do broker indisponível',
            },
        ])
    })

    it('não deixa uma dependência quebrada derrubar as outras', async () => {
        const sut = new SaudeService([
            quebrado('postgres'),
            quebrado('rabbitmq'),
        ])

        const relatorio = await sut.verificar()

        expect(relatorio.dependencias).toHaveLength(2)
        expect(relatorio.status).toBe('degradado')
    })

    it('trata falha sem Error como verificação falhou', async () => {
        const sut = new SaudeService([
            {
                nome: 'postgres',
                verificar: async () => {
                    throw 'string solta'
                },
            },
        ])

        const relatorio = await sut.verificar()

        expect(relatorio.dependencias[0].detalhe).toBe('verificação falhou')
    })
})
