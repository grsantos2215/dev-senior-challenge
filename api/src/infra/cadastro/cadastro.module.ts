import { CadastroEnriquecimentoConsumidor } from '../messaging/rabbit-mq/cadastro-enriquecimento.consumidor'
import { CadastroEnriquecimentoPublisher } from '../messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import { CadastroPort } from '@/application/services/cadastro-de-paciente/cadastro.port'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from '../database/database.module'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
import { HttpCadastroAdapter } from '../http/cadastro/http-cadastro.adapter'
import { MessagingModule } from '../messaging/messaging.module'
import { Module } from '@nestjs/common'
import { PacienteRepository } from '@/application/repositories/paciente-repository'
import { PrismaPacienteRepository } from '../database/prisma/repositories/prisma-paciente-repository'

/**
 * Tag `domain:token` para usar como chave de provider. O nome da classe e
 * simbolico e some do bundle; a tag sobrevive a minificação, que nem sempre
 * respeita o nome da classe em runtime.
 */
const PACIENTE_REPOSITORY = Symbol('PACIENTE_REPOSITORY')
const CADASTRO_PORT = Symbol('CADASTRO_PORT')
const ENRIQUECIMENTO_CADASTRO_PORT = Symbol('ENRIQUECIMENTO_CADASTRO_PORT')

@Module({
    imports: [DatabaseModule, MessagingModule, ConfigModule],
    providers: [
        GetOrCreatePaciente,

        {
            provide: PACIENTE_REPOSITORY,
            useClass: PrismaPacienteRepository,
        },
        {
            provide: PacienteRepository,
            useExisting: PACIENTE_REPOSITORY,
        },

        {
            provide: CADASTRO_PORT,
            useClass: HttpCadastroAdapter,
        },
        {
            provide: CadastroPort,
            useExisting: CADASTRO_PORT,
        },

        {
            provide: ENRIQUECIMENTO_CADASTRO_PORT,
            useClass: CadastroEnriquecimentoPublisher,
        },
        {
            provide: EnriquecimentoDeCadastroPort,
            useExisting: ENRIQUECIMENTO_CADASTRO_PORT,
        },

        CadastroEnriquecimentoConsumidor,
    ],
    exports: [
        GetOrCreatePaciente,
        PacienteRepository,
        CadastroPort,
        EnriquecimentoDeCadastroPort,
    ],
})
export class CadastroModule {}
