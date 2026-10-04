import { ConfigModule, ConfigService } from '@nestjs/config'

import { AgendamentoPort } from '@/application/services/agendamento/agendamento.port'
import { CadastroPort } from '@/application/services/cadastro-de-paciente/cadastro.port'
import { HTTP_TIMEOUT_MS } from '../tokens/http-timeout'
import { HttpAgendamentoAdapter } from './agendamento/http-agendamento.adapter'
import { HttpCadastroAdapter } from './cadastro/http-cadastro.adapter'
import { Module } from '@nestjs/common'

const AGENDAMENTO_PORT = Symbol('AGENDAMENTO_PORT')
const CADASTRO_PORT = Symbol('CADASTRO_PORT')
const TIMEOUT_PADRAO_MS = 5_000

/**
 * Dono das integrações com sistemas externos.
 *
 * Existe para que cada adapter HTTP tenha **um** dono. Repetir o binding em
 * cada módulo que precisa dele cria uma instância por módulo, cada uma com seu
 * timeout, e nenhum lugar do código responde "qual é o timeout do cadastro?".
 *
 * As portas é que saem daqui, nunca os adapters: quem consome depende de
 * `CadastroPort`/`AgendamentoPort`, e trocar axios por outra coisa não pode
 * vazar para a camada de aplicação.
 *
 * `useExisting` + tag segue o mesmo padrão de `CadastroModule`: a tag é um
 * `Symbol`, que sobrevive a minificação, enquanto o nome da classe não é
 * garantido em runtime.
 */
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: CADASTRO_PORT,
            useClass: HttpCadastroAdapter,
        },
        {
            provide: CadastroPort,
            useExisting: CADASTRO_PORT,
        },
        {
            provide: AGENDAMENTO_PORT,
            useClass: HttpAgendamentoAdapter,
        },
        {
            provide: AgendamentoPort,
            useExisting: AGENDAMENTO_PORT,
        },

        // Prover o token é o que faz a env valer. Sem este provider os dois
        // adapters caem no default por `@Optional()` e o `HTTP_TIMEOUT_MS` do
        // `.env` é ignorado em silêncio — o pior tipo de config quebrada,
        // porque parece configurada.
        {
            provide: HTTP_TIMEOUT_MS,
            useFactory: (config: ConfigService) =>
                Number(config.get('HTTP_TIMEOUT_MS')) || TIMEOUT_PADRAO_MS,
            inject: [ConfigService],
        },
    ],
    exports: [CadastroPort, AgendamentoPort, HTTP_TIMEOUT_MS],
})
export class ExternConnectionsModule {}
