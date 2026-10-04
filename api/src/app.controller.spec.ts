import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeAuditoria } from '@/helpers/fake-auditoria'
import { Test, TestingModule } from '@nestjs/testing'
import nock from 'nock'

import { AppController } from './app.controller'
import { AppService } from './app.service'

const AGENDAMENTO_URL = 'http://agendamento.test'
const CPF = '11111111111'

describe('AppController', () => {
    let appController: AppController
    let auditoria: FakeAuditoria

    beforeEach(async () => {
        auditoria = new FakeAuditoria()

        process.env.AGENDAMENTO_URL = AGENDAMENTO_URL

        const app: TestingModule = await Test.createTestingModule({
            controllers: [AppController],
            providers: [
                AppService,
                { provide: AuditoriaPort, useValue: auditoria },
            ],
        }).compile()

        appController = app.get<AppController>(AppController)
    })

    describe('root', () => {
        it('should return "Hello World!"', () => {
            expect(appController.getHello()).toBe('Hello World!')
        })
    })

    describe('getAgendamentos', () => {
        it('converte o XML em JSON', async () => {
            nock(AGENDAMENTO_URL)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    '<Agendamento><Medico>Dr. Silva</Medico></Agendamento>',
                )

            await expect(appController.getAgendamentos(CPF)).resolves.toEqual({
                Agendamento: { Medico: 'Dr. Silva' },
            })
        })

        it('audita a consulta bem-sucedida', async () => {
            nock(AGENDAMENTO_URL)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    '<Agendamento><Medico>Dr. Silva</Medico></Agendamento>',
                )

            await appController.getAgendamentos(CPF)

            expect(auditoria.acoes()).toEqual(['AGENDAMENTO_CONSULTADO'])
        })

        it('audita a falha da integração e propaga o erro', async () => {
            nock(AGENDAMENTO_URL)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(500, 'erro interno')

            await expect(appController.getAgendamentos(CPF)).rejects.toThrow(
                /Failed to fetch agendamentos/,
            )

            expect(auditoria.acoes()).toEqual(['INTEGRACAO_FALHOU'])
            expect(auditoria.contextos()[0]).toMatchObject({
                integracao: 'agendamento',
            })
        })

        it('não escreve o cpf no log', async () => {
            nock(AGENDAMENTO_URL)
                .get('/agendamento')
                .query({ cpf: CPF })
                .reply(
                    200,
                    '<Agendamento><Medico>Dr. Silva</Medico></Agendamento>',
                )

            await appController.getAgendamentos(CPF)

            expect(JSON.stringify(auditoria.contextos())).not.toContain(CPF)
        })
    })
})
