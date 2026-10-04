import { beforeEach, describe, expect, it } from 'vitest'

import { PrismaAuditoriaRepository } from './prisma-auditoria.repository'
import { PrismaService } from '../prisma.service'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'

class PrismaFalso {
    public readonly criados: unknown[] = []

    public falharNoCreate = false

    public log = {
        create: async ({ data }: { data: unknown }): Promise<unknown> => {
            if (this.falharNoCreate) throw new Error('logs indisponivel')

            this.criados.push(data)

            return data
        },
        findMany: async (): Promise<unknown[]> => [],
    }
}

describe('PrismaAuditoriaRepository', () => {
    let prisma: PrismaFalso
    let sut: PrismaAuditoriaRepository

    beforeEach(() => {
        prisma = new PrismaFalso()
        sut = new PrismaAuditoriaRepository(prisma as unknown as PrismaService)
    })

    describe('registrar', () => {
        it('grava a ação com o contexto', async () => {
            await sut.registrar(
                new RegistroAuditoria(
                    'CHECKIN_STATUS_ALTERADO',
                    { de: 'AGUARDANDO', para: 'EM_ATENDIMENTO' },
                    'checkin-1',
                    'paciente-1',
                ),
            )

            expect(prisma.criados).toHaveLength(1)
            expect(prisma.criados[0]).toMatchObject({
                acao: 'CHECKIN_STATUS_ALTERADO',
                checkinId: 'checkin-1',
                pacienteId: 'paciente-1',
                contexto: { de: 'AGUARDANDO', para: 'EM_ATENDIMENTO' },
            })
        })

        it('não propaga a falha do banco', async () => {
            prisma.falharNoCreate = true

            await expect(
                sut.registrar(new RegistroAuditoria('CHECKIN_CRIADO')),
            ).resolves.toBeUndefined()
        })

        it('não propaga a falha quando o id da foreign key não existe', async () => {
            prisma.log.create = async () => {
                throw new Error('violates foreign key constraint')
            }

            await expect(
                sut.registrar(
                    new RegistroAuditoria(
                        'CHECKIN_CRIADO',
                        {},
                        'checkin-inexistente',
                    ),
                ),
            ).resolves.toBeUndefined()
        })
    })

    describe('a guarda de dado pessoal', () => {
        it('recusa gravar antes de tocar no banco', () => {
            expect(
                () =>
                    new RegistroAuditoria('CHECKIN_CRIADO', {
                        cpf: '12345678901',
                    }),
            ).toThrow(/não pode carregar a chave/)

            expect(prisma.criados).toHaveLength(0)
        })
    })
})
