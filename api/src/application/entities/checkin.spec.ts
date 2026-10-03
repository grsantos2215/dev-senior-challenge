import { describe, expect, it } from 'vitest'

import { CheckIn, type CheckInProps } from './checkin'

const UUID = '11111111-1111-4111-8111-111111111111' as const

const baseMinimo: Omit<CheckInProps, 'criadoEm' | 'atualizadoEm'> = {
    status: 'AGUARDANDO',
    dataReferencia: new Date('2026-10-03T08:00:00Z'),
    pacienteId: '22222222-2222-4222-8222-222222222222',
    statusAgendamento: 'AUSENTE',
}

const base: CheckInProps = {
    ...baseMinimo,
    criadoEm: new Date('2026-10-03T08:00:00Z'),
    atualizadoEm: new Date('2026-10-03T08:00:00Z'),
}

// Sem os timestamps de props, para exercitar o preenchimento padrao da entidade.
const semTimestamps = () => new CheckIn(baseMinimo)

const novoCheckIn = () => new CheckIn(base)

const comAgendamento = (extra: Partial<CheckInProps> = {}) =>
    new CheckIn({
        ...base,
        statusAgendamento: 'PRESENTE',
        especialidade: 'Cardiologia',
        horario: '09:30',
        ...extra,
    })

describe('CheckIn', () => {
    describe('identidade', () => {
        it('gera um uuid no construtor', () => {
            expect(novoCheckIn().id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            )
        })

        it('gera ids diferentes para cada instancia', () => {
            expect(novoCheckIn().id).not.toBe(novoCheckIn().id)
        })

        it('nao aceita id externo no construtor', () => {
            expect(CheckIn.length).toBe(1)
        })

        it('nao expoe setter de id', () => {
            const checkIn = novoCheckIn()

            expect(() => {
                ;(checkIn as unknown as { id: string }).id = UUID
            }).toThrow()
        })

        it('hidratar preserva o id do banco', () => {
            expect(CheckIn.hidratar(UUID, base).id).toBe(UUID)
        })

        it('hidratar recusa id que nao e uuid', () => {
            expect(() => CheckIn.hidratar('chk-123', base)).toThrow(
                /id invalido para hidratação/,
            )
            expect(() => CheckIn.hidratar('', base)).toThrow()
            expect(() => CheckIn.hidratar('12345', base)).toThrow()
        })
    })

    describe('timestamps padrao', () => {
        it('preenche criadoEm quando ausente', () => {
            const antes = Date.now()
            const checkIn = semTimestamps()
            const depois = Date.now()

            expect(checkIn.criadoEm.getTime()).toBeGreaterThanOrEqual(antes)
            expect(checkIn.criadoEm.getTime()).toBeLessThanOrEqual(depois)
        })

        it('preserva criadoEm quando informado', () => {
            const criadoEm = new Date('2020-01-01T00:00:00Z')

            expect(new CheckIn({ ...base, criadoEm }).criadoEm).toBe(criadoEm)
        })

        it('atualizadoEm nasao e obrigatorio e herda de criadoEm', () => {
            const criadoEm = new Date('2020-01-01T00:00:00Z')
            const checkIn = new CheckIn({ ...baseMinimo, criadoEm })

            expect(checkIn.atualizadoEm).toBe(criadoEm)
        })

        it('preserva atualizadoEm quando informado', () => {
            const atualizadoEm = new Date('2021-02-02T00:00:00Z')

            expect(new CheckIn({ ...base, atualizadoEm }).atualizadoEm).toBe(
                atualizadoEm,
            )
        })
    })

    describe('toJSON', () => {
        it('inclui o id gerado', () => {
            const checkIn = novoCheckIn()

            expect(checkIn.toJSON().id).toBe(checkIn.id)
        })

        it('devolve todas as props', () => {
            const checkIn = comAgendamento()

            expect(checkIn.toJSON()).toEqual({
                id: checkIn.id,
                status: 'AGUARDANDO',
                dataReferencia: base.dataReferencia,
                pacienteId: base.pacienteId,
                statusAgendamento: 'PRESENTE',
                especialidade: 'Cardiologia',
                medico: null,
                horario: '09:30',
                iniciadoEm: null,
                finalizadoEm: null,
                criadoEm: checkIn.criadoEm,
                atualizadoEm: checkIn.atualizadoEm,
            })
        })

        it('reflete o estado apos o ciclo de vida', () => {
            const checkIn = comAgendamento()
            checkIn.iniciado()
            checkIn.finalizado()

            const json = checkIn.toJSON()

            expect(json.status).toBe('FINALIZADO')
            expect(json.iniciadoEm).toBeInstanceOf(Date)
            expect(json.finalizadoEm).toBeInstanceOf(Date)
        })

        it('e o que JSON.stringify usa', () => {
            const checkIn = novoCheckIn()

            expect(JSON.parse(JSON.stringify(checkIn)).id).toBe(checkIn.id)
        })
    })

    describe('props', () => {
        it('atualiza statusAgendamento pelo setter', () => {
            const checkIn = novoCheckIn()

            checkIn.statusAgendamento = 'INDISPONIVEL'

            expect(checkIn.statusAgendamento).toBe('INDISPONIVEL')
        })

        it('atualiza pacienteId e dataReferencia pelos setters', () => {
            const checkIn = novoCheckIn()
            const novaData = new Date('2026-10-04T09:00:00Z')

            checkIn.pacienteId = '33333333-3333-4333-8333-333333333333'
            checkIn.dataReferencia = novaData

            expect(checkIn.pacienteId).toBe(
                '33333333-3333-4333-8333-333333333333',
            )
            expect(checkIn.dataReferencia).toBe(novaData)
        })

        it('normaliza undefined para null no setter', () => {
            const checkIn = comAgendamento()

            checkIn.medico = 'Dra. Alcantara'
            checkIn.medico = undefined

            expect(checkIn.medico).toBeNull()
        })

        it('nao limpa especialidade nem horario enquanto PRESENTE', () => {
            const checkIn = comAgendamento()

            expect(() => {
                checkIn.especialidade = undefined
            }).toThrow(/PRESENTE exige especialidade/)
            expect(() => {
                checkIn.horario = null
            }).toThrow(/PRESENTE exige horario/)

            expect(checkIn.especialidade).toBe('Cardiologia')
            expect(checkIn.horario).toBe('09:30')
        })

        it('comeca com os campos de agendamento nulos, nao indefinidos', () => {
            const checkIn = novoCheckIn()

            expect(checkIn.especialidade).toBeNull()
            expect(checkIn.medico).toBeNull()
            expect(checkIn.horario).toBeNull()
        })
    })

    describe('agendamento PRESENTE', () => {
        it('aceita constructed com especialidade e horario', () => {
            const checkIn = comAgendamento()

            expect(checkIn.statusAgendamento).toBe('PRESENTE')
        })

        it('recusa PRESENTE sem especialidade no construtor', () => {
            expect(() => comAgendamento({ especialidade: undefined })).toThrow(
                /PRESENTE exige especialidade/,
            )
        })

        it('recusa PRESENTE sem horario no construtor', () => {
            expect(() => comAgendamento({ horario: undefined })).toThrow(
                /PRESENTE exige horario/,
            )
        })

        it('recusa string vazia, que passaria no CHECK do banco', () => {
            expect(() => comAgendamento({ especialidade: '' })).toThrow()
        })

        it('recusa marcar PRESENTE antes de preencher os campos', () => {
            const checkIn = novoCheckIn()

            expect(() => {
                checkIn.statusAgendamento = 'PRESENTE'
            }).toThrow(/PRESENTE exige especialidade/)
            expect(checkIn.statusAgendamento).toBe('AUSENTE')
        })

        it('aceita marcar PRESENTE depois de preencher os campos', () => {
            const checkIn = novoCheckIn()

            checkIn.especialidade = 'Cardiologia'
            checkIn.horario = '09:30'
            checkIn.statusAgendamento = 'PRESENTE'

            expect(checkIn.statusAgendamento).toBe('PRESENTE')
        })

        it('desfaz a mutacao que quebraria a regra', () => {
            const checkIn = comAgendamento()

            expect(() => {
                checkIn.horario = null
            }).toThrow(/PRESENTE exige horario/)
            // A entidade nao pode ficar pela metade.
            expect(checkIn.horario).toBe('09:30')
            expect(checkIn.statusAgendamento).toBe('PRESENTE')
        })

        it('deixa limpar o horario quando nao e PRESENTE', () => {
            const checkIn = novoCheckIn()

            checkIn.horario = '09:30'
            checkIn.horario = null

            expect(checkIn.horario).toBeNull()
        })
    })

    describe('iniciado()', () => {
        it('marca o inicio e move para EM_ATENDIMENTO', () => {
            const checkIn = novoCheckIn()

            checkIn.iniciado()

            expect(checkIn.iniciadoEm).toBeInstanceOf(Date)
            expect(checkIn.status).toBe('EM_ATENDIMENTO')
            expect(checkIn.finalizadoEm).toBeNull()
        })

        it('e idempotente: nao sobrescreve o horario real de chegada', async () => {
            const checkIn = novoCheckIn()
            checkIn.iniciado()
            const primeiro = checkIn.iniciadoEm

            await new Promise((resolve) => setTimeout(resolve, 20))
            checkIn.iniciado()

            expect(checkIn.iniciadoEm).toBe(primeiro)
        })
    })

    describe('finalizado()', () => {
        it('marca o fim e move para FINALIZADO', () => {
            const checkIn = novoCheckIn()
            checkIn.iniciado()

            checkIn.finalizado()

            expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
            expect(checkIn.status).toBe('FINALIZADO')
        })

        it('recusa finalizar sem inicio, em vez de deixar o banco barrar', () => {
            const checkIn = novoCheckIn()

            expect(() => checkIn.finalizado()).toThrow(
                /não pode ser finalizado sem início/,
            )
            expect(checkIn.finalizadoEm).toBeNull()
            expect(checkIn.status).toBe('AGUARDANDO')
        })

        it('e idempotente', async () => {
            const checkIn = novoCheckIn()
            checkIn.iniciado()
            checkIn.finalizado()
            const primeiro = checkIn.finalizadoEm

            await new Promise((resolve) => setTimeout(resolve, 20))
            checkIn.finalizado()

            expect(checkIn.finalizadoEm).toBe(primeiro)
        })
    })

    describe('cancelar()', () => {
        it('cancela um check-in em atendimento', () => {
            const checkIn = novoCheckIn()
            checkIn.iniciado()

            checkIn.cancelar()

            expect(checkIn.status).toBe('CANCELADO')
            expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
        })

        it('cancela direto da fila sem carimbar um inicio falso', () => {
            const checkIn = novoCheckIn()

            checkIn.cancelar()

            expect(checkIn.status).toBe('CANCELADO')
            expect(checkIn.finalizadoEm).toBeInstanceOf(Date)
            expect(checkIn.iniciadoEm).toBeNull()
        })

        it('e idempotente', async () => {
            const checkIn = novoCheckIn()
            checkIn.cancelar()
            const primeiro = checkIn.finalizadoEm

            await new Promise((resolve) => setTimeout(resolve, 20))
            checkIn.cancelar()

            expect(checkIn.finalizadoEm).toBe(primeiro)
        })
    })

    describe('maquina de estados', () => {
        it('barra voltar de FINALIZADO para AGUARDANDO', () => {
            const checkIn = novoCheckIn()
            checkIn.iniciado()
            checkIn.finalizado()

            expect(() => {
                checkIn.status = 'AGUARDANDO'
            }).toThrow(/Transição inválida/)
            expect(checkIn.status).toBe('FINALIZADO')
        })

        it('barra pular de AGUARDANDO direto para FINALIZADO', () => {
            const checkIn = novoCheckIn()

            expect(() => {
                checkIn.status = 'FINALIZADO'
            }).toThrow(/Transição inválida/)
            expect(checkIn.status).toBe('AGUARDANDO')
        })

        it('nao deixa EM_ATENDIMENTO sem iniciadoEm', () => {
            const checkIn = novoCheckIn()

            expect(() => {
                checkIn.status = 'EM_ATENDIMENTO'
            }).toThrow(/exige iniciadoEm/)
            expect(checkIn.status).toBe('AGUARDANDO')
        })

        it('recusa AGUARDANDO construido com iniciadoEm', () => {
            expect(() => novoCheckIn()).not.toThrow()
            expect(() =>
                CheckIn.hidratar(UUID, {
                    ...base,
                    iniciadoEm: new Date(),
                }),
            ).toThrow(/AGUARDANDO não aceita/)
        })

        it('aceita repetir o status atual sem erro', () => {
            const checkIn = novoCheckIn()

            checkIn.status = 'AGUARDANDO'

            expect(checkIn.status).toBe('AGUARDANDO')
        })
    })

    describe('atualizado()', () => {
        it('marca a ultima escrita', () => {
            const checkIn = novoCheckIn()
            const antes = checkIn.atualizadoEm

            checkIn.atualizado()

            expect(checkIn.atualizadoEm).toBeInstanceOf(Date)
            expect(checkIn.atualizadoEm.getTime()).toBeGreaterThanOrEqual(
                antes.getTime(),
            )
        })

        it('nunca mexe em criadoEm', async () => {
            const criadoEm = new Date('2020-01-01T00:00:00Z')
            const checkIn = new CheckIn({ ...base, criadoEm })

            await new Promise((resolve) => setTimeout(resolve, 20))
            checkIn.atualizado()

            expect(checkIn.criadoEm).toBe(criadoEm)
        })
    })

    describe('conformidade com os CHECKs do banco', () => {
        // Traducao literal dos dois CHECKs. Se o SQL mudar, este bloco e o
        // que avisa antes do INSERT falhar em producao.
        const violaCiclo = (
            status: string,
            inicio: unknown,
            fim: unknown,
        ): string | null => {
            const temInicio = Boolean(inicio)
            const temFim = Boolean(fim)

            if (status === 'AGUARDANDO' && !temInicio && !temFim) return null
            if (status === 'EM_ATENDIMENTO' && temInicio && !temFim) return null
            if (status === 'FINALIZADO' && temInicio && temFim) return null
            if (status === 'CANCELADO' && temFim) return null
            return 'checkins_ciclo_de_vida_chk'
        }

        const violaPresente = (c: CheckIn): string | null =>
            c.statusAgendamento === 'PRESENTE' &&
            (!c.especialidade || !c.horario)
                ? 'checkins_agendamento_presente_chk'
                : null

        const cenarios: Array<[string, (c: CheckIn) => void]> = [
            ['so construir', () => {}],
            ['atualizado', (c) => c.atualizado()],
            ['iniciado', (c) => c.iniciado()],
            [
                'iniciado 2x',
                (c) => {
                    c.iniciado()
                    c.iniciado()
                },
            ],
            [
                'iniciado+atualizado',
                (c) => {
                    c.iniciado()
                    c.atualizado()
                },
            ],
            [
                'iniciado+finalizado',
                (c) => {
                    c.iniciado()
                    c.finalizado()
                },
            ],
            [
                'iniciado+finalizado+atualizado',
                (c) => {
                    c.iniciado()
                    c.finalizado()
                    c.atualizado()
                },
            ],
            [
                'iniciado+cancelar',
                (c) => {
                    c.iniciado()
                    c.cancelar()
                },
            ],
            ['cancelar direto', (c) => c.cancelar()],
            [
                'cancelar 2x',
                (c) => {
                    c.cancelar()
                    c.cancelar()
                },
            ],
            [
                'cancelar+atualizado',
                (c) => {
                    c.cancelar()
                    c.atualizado()
                },
            ],
            [
                'finalizado+cancelar',
                (c) => {
                    c.iniciado()
                    c.finalizado()
                    c.cancelar()
                },
            ],
        ]

        it.each(cenarios)(
            '%s: estado aceito pelos dois CHECKs',
            (_nome, acao) => {
                const checkIn = novoCheckIn()
                acao(checkIn)

                const estado = `${checkIn.status}/${checkIn.iniciadoEm}/${checkIn.finalizadoEm}`

                expect(
                    violaCiclo(
                        checkIn.status,
                        checkIn.iniciadoEm,
                        checkIn.finalizadoEm,
                    ),
                    estado,
                ).toBeNull()
                expect(violaPresente(checkIn), estado).toBeNull()
            },
        )

        it('PRESENTE permanece valido em todo o ciclo de vida', () => {
            for (const [_nome, acao] of cenarios) {
                const checkIn = comAgendamento()
                acao(checkIn)

                expect(
                    violaCiclo(
                        checkIn.status,
                        checkIn.iniciadoEm,
                        checkIn.finalizadoEm,
                    ),
                    _nome,
                ).toBeNull()
                expect(violaPresente(checkIn), _nome).toBeNull()
            }
        })
    })
})
