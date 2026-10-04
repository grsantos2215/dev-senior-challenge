import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { Controller, Get, Query } from '@nestjs/common'
import { RegistroAuditoria } from '@/application/entities/registro-auditoria'
import { AppService } from './app.service'
import axios from 'axios'
import { convertXmlToJson } from './lib/xml-converter'

@Controller()
export class AppController {
    constructor(
        private readonly appService: AppService,
        private readonly auditoria: AuditoriaPort,
    ) {}

    @Get()
    getHello(): string {
        return this.appService.getHello()
    }

    @Get('agendamentos')
    async getAgendamentos(@Query('cpf') cpf: string) {
        try {
            const api = await axios.get(
                `${process.env.AGENDAMENTO_URL}/agendamento?cpf=${cpf}`,
            )

            const result = convertXmlToJson(api.data)

            await this.auditoria.registrar(
                new RegistroAuditoria('AGENDAMENTO_CONSULTADO', {
                    statusRequisicao: api.status,
                }),
            )

            return result
        } catch (error) {
            await this.auditoria.registrar(
                new RegistroAuditoria('INTEGRACAO_FALHOU', {
                    integracao: 'agendamento',
                    erro: error instanceof Error ? error.name : 'desconhecido',
                }),
            )

            throw new Error(`Failed to fetch agendamentos, ${error}`)
        }
    }
}
