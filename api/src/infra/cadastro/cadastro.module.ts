import { CadastroEnriquecimentoConsumidor } from '../messaging/rabbit-mq/cadastro-enriquecimento.consumidor'
import { CadastroEnriquecimentoPublisher } from '../messaging/rabbit-mq/cadastro-enriquecimento.publisher'
import { DatabaseModule } from '../database/database.module'
import { EnriquecimentoDeCadastroPort } from '@/application/services/cadastro-de-paciente/enriquecimento-cadastro.port'
import { ExternConnectionsModule } from '../http/extern-connections.module'
import { GetOrCreatePaciente } from '@/application/use-cases/paciente/get-or-create-paciente'
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
const ENRIQUECIMENTO_CADASTRO_PORT = Symbol('ENRIQUECIMENTO_CADASTRO_PORT')

@Module({
    imports: [DatabaseModule, MessagingModule, ExternConnectionsModule],
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
        EnriquecimentoDeCadastroPort,
    ],
})
export class CadastroModule {}
