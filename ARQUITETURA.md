# Arquitetura & Decisões — [seu nome]

> Este é o documento mais importante da sua entrega. Não precisa ser longo —
> precisa deixar claro **o que você decidiu e por quê**. Sinta-se livre para
> ajustar a estrutura.

## Visão geral

_Um diagrama (pode ser ASCII) ou uma descrição do desenho: componentes, fluxo de
um check-in de ponta a ponta, onde entram os serviços externos e a mensageria._

## Recorte

_O que você escolheu implementar de fato (a fatia vertical) e o que deixou como
desenho/documentação. Por quê._

## Decisões (ADRs)

### ADR 1 - Outbox transacional para o evento de check-in

- **Contexto:** cada check-in precisa publicar um evento para outros sistemas
  reagirem. Publish no fim do fluxo tem uma janela de perda: se o commit do
  check-in dá certo e o publish falha, o evento se perde e ninguém percebe. O
  inverso também quebra, publicar antes do commit gera evento pra um check-in
  que pode não existir.
- **Decisão:** tabela `outbox_events` escrita **na mesma transação** do
  check-in. Um dispatcher lê o que está com `publicado_em IS NULL` (índice
  parcial), publica, e marca `publicado_em`. Contador de `tentativas` para o
  retry.
- **Alternativas consideradas:**
    - `emit()` direto no fim do fluxo (o que fiz primeiro): zero infra, e é onde
      comecei. Descartado porque a perda de evento é silenciosa, é o pior tipo
      de bug.
    - Publicar antes do commit: descarta por causa do evento fantasma.
    - Broker transacional dedicado: resolve, mas é uma aplicação a mais para dar
      manutenção.
- **Consequências:**
    - O evento não se perde, e reprocessar é reprocessar a tabela. O `id` serve
      de chave de idempotência para quem consome.
    - **A entrega é at-least-once, não exactly-once.** O consumidor vai ver
      duplicata em retry. Isso precisa estar escrito no contrato do evento, não
      descoberto em produção.
    - Custo: latência = intervalo de poll do dispatcher, uma tabela e um
      processo a mais.
    - O Prisma não versiona índice parcial → o
      `CREATE INDEX ... WHERE publicado_em IS NULL` foi escrito à mão após a
      migration.
- **Status: decisão tomada, ainda não implementada.** A tabela `outbox_events`
  existe no schema, mas o check-in publica `checkin.created` direto por
  `CheckinEventsPublisher`, sem transação e sem dispatcher. Ou seja: **a janela
  de perda que motivou este ADR continua aberta.** Não estou fingindo o
  contrário — o ADR fica como contrato do que falta, e o publish direto é o que
  roda.

### ADR 2 - Log append-only

- **Contexto:** o dado é sensível (LGPD). Precisamos de rastreabilidade das
  transições da fila e das chamadas às integrações, sem transformar o banco num
  segundo depósito de informações pessoais, como já tem na API legado.
- **Decisão:** tabela `logs` **append-only**, com `acao` enum estruturado no
  lugar de `mensagem` em texto livre, `contexto` em jsonb, e FK para `checkin` e
  `paciente`. Trigger `BEFORE UPDATE OR DELETE` que levanta exceção. Sem data de
  atualização, de propósito, pois um log não serve para ser atualizado, e sim
  para auditoria.
- **Alternativas consideradas:**
    - Só log em stdout (padrão do Nest): some no restart, não serve como trilha
      de auditoria.
    - Tabela mutável com `updatedAt`: se alguém corrige um log, o rastro perde
      credibilidade.
    - Guardar o payload integral da integração: descartado, o XML do legado e o
      JSON do cadastro possuem informações que contradizem a LGPD (CPF, nome,
      nascimento).
- **Consequências:**
    - `contexto` é jsonb sem schema e pode virar depósito de lixo. Mitigação por
      revisão de código: o log referencia `checkinId`, não carrega o dado do
      paciente.
    - O direito ao esquecimento pede `DELETE`, e um log que recusa `DELETE` não
      atende. Resolvi da seguinte forma: como o log não guarda informações
      pessoais, ele sobrevive à eliminação do paciente sem persistir o dado.
    - Apagar um paciente não apaga o log (`ON DELETE SET NULL`). A auditoria
      fica correta, mas pode abrir uma lacuna com relação aos dados.

### ADR 3 - RabbitMQ como topics

- **Contexto:** o README comenta sobre evento por check-in para outros sistemas
  reagirem (painel de senha, notificação da equipe). Precisa de desacoplamento:
  quem publica não conhece quem consome. O broker já vem no `docker-compose.yml`
  (AMQP na porta 5672).
- **Decisão:** `@nestjs/microservices` `ClientRMQ`, topic exchange
  `checkin.events`, routing key `checkin.created`, mensagens `persistent`, e
  **sem informações pessoais no payload**.
- **Alternativas consideradas:**
    - **MQTT:** era o que o código original usava (`ServerMqtt`). Ficou errado,
      pois o broker expõe AMQP e o plugin `rabbitmq_mqtt` não está habilitado na
      imagem. Caia assim que a primeira conexão acontecia.
    - HTTP/webhook para cada consumidor: acopla a API à disponibilidade de cada
      consumidor, exatamente o que o broker evita.
    - Kafka: não está no compose e é desproporcional para um evento por
      check-in.
    - Exchange `fanout`: perde o roteamento por tipo de evento. Com `topic`, o
      painel pode assinar só `checkin.*`.
- **Consequências:**
    - **Detalhe importante:** `assertExchange` no Nest só roda quando
      `wildcards: true` ou `exchangeType: 'fanout'`. Sem isso o exchange nunca é
      criado, e o `publish` falha com 404 de forma silenciosa. Além disso o
      default de `exchange` é o **nome da fila**. Isso não está documentado; só
      apareceu lendo a documentação e exemplos de uso do pacote.
    - Entrega at-least-once: quem consome precisa ser idempotente. O `eventId`
      no payload existe para isso.
    - Routing key é contrato. Mudá-la quebra consumidores silenciosamente.

### ADR 4 - Status de agendamento como tri-state

- **Contexto:** o sistema legado devolve `possuiAgendamento` booleano, mas falha
  com `500` em ~10% das chamadas. O README do legado faz a pergunta direto: _"um
  check-in deveria falhar por completo porque o legado caiu?"_
- **Decisão:** `statusAgendamento` com `PRESENTE | AUSENTE | INDISPONIVEL`,
  default `INDISPONIVEL`. O check-in é criado mesmo com o legado fora; os dados
  ficam nulos e o status registra que não deu para perguntar.
- **Alternativas consideradas:**
    - Falhar o check-in quando o legado cai: mais simples, mas a recepção perde
      o paciente por causa de um sistema que só faz enriquecimento, CPF e nome
      já vieram do cadastro.
    - Booleano `possuiAgendamento`: confunde "não tem agendamento" com "não deu
      para perguntar". Descartado; é o que o DTO original fazia, vide os commits
      iniciais.
    - `boolean` nullable (null = não sei): funciona, mas a distinção entre "não
      consultou" e "consultou e vazio" se perde, e é mais fácil de errar em
      código.
    - Retry no legado até responder: converte 10% de falha em latência pior para
      todo mundo.
- **Consequências:**
    - O default `INDISPONIVEL` força a decisão explícita na aplicação, não dá
      para criar check-in com `AUSENTE` por acidente.
    - Dá para medir a saúde da integração contando por status, e daí virar
      alerta.
    - CHECK no banco exige `especialidade` e `horario` quando o status é
      `PRESENTE`, o que pega bug de mapeamento na raiz em vez de deixar dado
      sujo passar.
    - O que é perdido: o paciente entra sem informação de agendamento. Aceito, a
      recepção consulta o legado por fora se precisar. A degradação é graciosa
      **e explícita**.

### ADR 5 - Prisma como ORM

- **Contexto:** NestJS + TypeScript sobre Postgres. Precisa de tipos no código
  de aplicação, migrations versionadas, e acesso às constraints que o ORM não
  modela.
- **Decisão:** Prisma 7 com o generator `prisma-client` apontando para
  `src/generated`, e o adapter `PrismaPg` (o `PrismaClient` com pool próprio
  competiria com o Fastify).
- **Alternativas consideradas:**
    - TypeORM: mais maduro em decorators e herança, e foi o padrão do Nest até a
      v10. Tipos piores e `jsonb`/`@db.Time()` mais chatos.
    - Drizzle: tipos melhores e mais perto do SQL. Migrar depois é barato.
      Descartado por unfamiliaridade com a stack, não por defeito técnico.
    - `pg` puro: controle máximo, zero tipos, migration à mão.
- **Consequências:**
    - **O Prisma não versiona CHECK, índice parcial nem trigger.** Escrevi à mão
      no `migration.sql`. E ele não sabe que esses objetos existem, então um
      `migrate dev` futuro pode apontar drift, **não removam as constraints para
      "limpar" o drift**.
    - `@db.Time()` num campo `DateTime` funciona, mas o TypeScript diz `Date`
      com epoch 1970. Ruído no código; um `String` seria mais simples aqui.
    - `prisma generate` é passo separado: não roda sozinho em todo
      `migrate dev`, e um client desatualizado compila e passa testes.

### ADR 6 - Fastify como plataforma HTTP

- **Contexto:** o Nest não é um servidor HTTP, é um framework sobre um. O
  Express é o default, mas a
  [documentação oficial](https://docs.nestjs.com/techniques/performance) diz que
  o Fastify é "almost two times better" em benchmark, e que "Fastify can be a
  better choice when you place high value on very fast performance". A
  justificativa do default é outra: o Express é "widely-used, well-known, and
  has an enormous set of compatible middleware". Ou seja, trocar por Fastify é
  trocar ecossistema por velocidade.
- **Decisão:** `FastifyAdapter` em `src/main.ts:11-14`, com
  `@nestjs/platform-fastify`.
- **Alternativas consideradas:**
    - Express, que é o default: todo tutorial, receita e middleware funciona. É
      a escolha legítima, e a que a maioria dos projetos faz.
    - Fastify sem o Nest: o throughput sobe, mas perde DI, módulos e decorators,
      que é o que dá estrutura ao resto do projeto.
    - Ficar no default sem pensar no assunto: adia a decisão, não resolve.
- **Consequências:**
    - **O número do benchmark não é o argumento principal, e citá-lo como tal
      seria desonesto.** Esta API é limitada por I/O, não por CPU: o cadastro
      responde em ~600ms e o legado em ~800ms. A vantagem do Fastify é em
      workload CPU-bound e some atrás da espera de rede e de banco. A resposta
      honesta para "qual o ganho?" é: pouco, neste sistema.
    - O que muda de verdade é o caminho. O Fastify pré-compila o roteamento, e a
      serialização de JSON pode ser pré-compilada por schema.
    - **E essa segunda parte ainda não está em uso.** A validação hoje é
      `ValidationPipe` com `class-validator`, que é agnóstico de framework. O
      `fast-json-stringify` só entra com response schemas. Esse é o próximo
      passo, e é onde está o ganho real de performance, não no roteador.
    - O custo é que receitas que assumem Express deixam de funcionar. Redirect
      exige `res.status(302).redirect(url)`, e middleware recebe `req.raw` e
      `res.raw`, porque o Nest usa `@fastify/middie` por baixo.
- Na v12 o mapeamento de erro foi reescrito entre core, Express e Fastify.
  Filtro de exceção precisa de teste antes de confiar no comportamento em
  produção. - **`app.listen(port)` sem host quebra a porta publicada do
  Docker.** O Express, que é o default, faz bind em `0.0.0.0`; o Fastify usa
  `localhost` como padrão e `app.listen(port)` não passa host. O sintoma é
  silencioso e só aparece no container: a app responde em `127.0.0.1` dentro
  dele e recusa conexão no IP da rede, então `curl` no host devolve
  `http_code=000` com a porta declarada como publicada. Passou despercebido até
  o compose ser exercitado de fora. Por isso `main.ts` faz
  `app.listen(port, '0.0.0.0')`. - A volta para o Express é uma linha, então o
  custo de ter escolhido errado é baixo.

### ADR 7 - Cancelamento sem horário de início

- **Contexto:** o `checkins_ciclo_de_vida_chk` original exigia
  `iniciado_em IS NOT NULL` tanto para `FINALIZADO` quanto para `CANCELADO`.
  Isso forçou a entidade a carimbar um horário de início em um check-in que
  nunca foi atendido: paciente foi embora da fila e o registro passou a dizer
  que ele tinha chegado.
- **Decisão:** `CANCELADO` passa a exigir apenas `finalizado_em IS NOT NULL`.
  `iniciado_em` fica livre. Quem foi atendido tem início e fim; quem cancelou
  tem só o fim.
- **Alternativas consideradas:**
    - Deixar o CHECK como estava e gerar `iniciado_em` na aplicação: preserva o
      schema e mente no dado. O registro fica errado.
    - Criar um `cancelado_em` separado de `finalizado_em`: distingue as duas
      coisas, mas são o mesmo evento e custa uma coluna e uma segunda entrada no
      CHECK.
    - Barrar cancelamento de check-in que não começou: obriga a recepção a
      chamar `iniciado()` antes de cancelar, o que é mais trabalho para a
      recepção.
- **Consequências:**
    - Migration `20261003194500_cancela_sem_inicio` faz `DROP CONSTRAINT` e
      recria a mesma constraint. **Não editei a migration anterior**, que já
      está aplicada
    - `finalizado()` ganhou guard explícito, porque `validar()` reportaria o
      status alvo (`FINALIZADO exige iniciadoEm`) em vez do que o chamador fez
      de errado.
    - O CHECK ficou mais frouxo, e a entidade ficou mais forte. É a direção
      certa: o banco é a última linha de defesa, não a única.
    - **Os dois CHECKs agora estão duplicados em `CheckIn.validar()`.** Essa
      duplicação é deliberada e cobre a mudança do SQL; o teste de conformidade
      em `checkin.spec.ts` traduz os dois de volta e falha se a entidade
      divergir. Se um dia o SQL mudar, será necessário alterar aqui.
    - `checkins_checkin_aberto_por_dia_unq` não foi afetado: ele filtra por
      `status IN ('AGUARDANDO','EM_ATENDIMENTO')`, e `CANCELADO` nunca entra
      nessa contagem desde a migration anterior.

### ADR 8 - Enriquecimento de paciente fora do caminho da request

- **Contexto:** `GetOrCreatePaciente` precisa do nome e da data de nascimento do
  paciente, mas o mock de cadastro responde ~600ms, falha ~10% das vezes e
  limita a 5 requisições por 10s por IP. Chamar isso dentro da request custava
  600ms em **toda** recepção e, no pior caso, deixava um erro de terceiro
  decidir se o paciente entra. Como o CPF já vem do cadastro do paciente, o nome
  é _enriquecimento_, não requisito: dá para gravar o paciente primeiro e
  completar depois.
- **Decisão:** a request grava o paciente em estado degradado
  (`cadastroConfirmado = false`) e enfileira `{ pacienteId, tentativa }` na fila
  durável `cadastro.enriquecer`. O payload leva **só o id**: quem enfileira não
  conhece o CPF, e o consumidor lê o paciente do banco. Nenhum dado pessoal no
  payload (ADR 3). O consumidor é idempotente
  `if (paciente.cadastroConfirmado) return`, então reenfileirar é seguro e é o
  caminho normal.
- **Alternativas consideradas:**
    - Síncrono, com retry: preserva a resposta completa e é o que o fluxo
      original fazia. Descartado porque amarra o tempo de atendimento da
      recepção à disponibilidade de um sistema que só enriquece.
    - Gravar o paciente e enriquecer na sequência, sem fila: se o processo morre
      entre o commit e a chamada, o paciente fica degradado para sempre e
      ninguém percebe. É a mesma janela de perda do ADR 1, em escala menor.
    - Marcar "pendência" numa tabela e varrer por polling: entrega o mesmo
      desenho com menos peças, e mais um `SELECT` no caminho do check-in. A fila
      dá o mesmo resultado com retry e DLQ prontos.
- **Consequências:**
    - A request deixa de depender dos 600ms do cadastro, **mas não deixa de
      depender do broker**: `ClientRMQ.emit` é request/reply, então
      `enfileirar()` espera a resposta do consumidor. É um round-trip de ms, não
      de 600ms, e é um acoplamento que precisa de timeout antes de produção.
      Hoje não há, e `emit` sem consumidor estoura a request.
    - A degradação virou estado observável em vez de erro:
      `enriquecimentoPendente` no retorno e `cadastroConfirmado` no banco. Quem
      lê o paciente consegue dizer "ainda não".
    - A entrega é at-least-once, então a idempotência não é opcional
      (consequência herdada do ADR 3).
    - **A fila não melhorou o rate limit.** 5 req/10s por IP continua valendo.
      Quem controla o ritmo é o pacing do consumidor.

### ADR 9 - Resiliência da integração com o cadastro REST

- **Contexto:** mesma situação do ADR 8: dependência externa lenta, instável e
  com limite de taxa. O enunciado pergunta o que fazer quando ela cai, e a
  resposta para o caso foi "continuar e sinalizar".
- **Decisão:** timeout explícito (`HTTP_TIMEOUT_MS` via `AbortSignal`) e falha
  classificada em três erros de domínio, porque eles têm consumidores
  diferentes: `CadastroRateLimitado` (429), `CadastroIndisponivel` (5xx e
  timeout) e `PacienteNaoEncontrado` (404). As duas primeiras valem retry; a
  terceira é definitiva. O ritmo é imposto no cliente — `prefetchCount: 1` e
  intervalo mínimo de 2200ms entre chamadas — em vez de tentar negociar com o
  mock.
- **Alternativas consideradas:**
    - Sem timeout: herda o default do axios, que pode passar de minutos e segura
      uma conexão do pool esse tempo todo.
    - Retry exponencial com jitter: é a escolha certa para falha transitória em
      geral, mas aqui existe um limite artificial e determinístico; backoff
      multiplicaria tentativas contra um teto que não cede.
    - Confiar no rate limit do servidor e ir no máximo: com limite de 5 por 10s,
      o quinto check-in leva a resposta com 429 e vira retry.
    - **Circuit breaker:** descartado por ora. Com pacing de 2,2s, teto de 3
      tentativas e reenfileiramento, o ganho é pequeno e o custo é um estado a
      mais para justificar o corte. Reavaliar quando houver erro sustentado.
    - **Cache de resposta do cadastro:** descartado. O dado praticamente não
      muda, mas cache aqui exige invalidação num serviço que já degrada de
      propósito.
- **Consequências:**
    - O pacing é por instância. Duas réplicas dividida por 2,2s cada uma somam
      mais que o pretendido; num ambiente real o intervalo precisaria ser
      coordenado, e o broker resolve isso com consumer único ou prefetch baixo.
    - Erro inesperado no adapter **não** vira retry: vira log e paciente
      degradado. Um bug de programação não pode virar loop quente.

### ADR 10 - Fila durável

- **Contexto:** no ADR 3 eu documentei o lado do publisher. O lado do consumidor
  tem uma armadilha que só aparece em produção: com `wildcards: true`, o
  `ClientRMQ` declara **só o exchange** e nunca cria fila nem binding
  (client-rmq.ts, ramo `else` de `setupChannel`). Publicar em exchange sem fila
  bindada **não dá erro**, o broker aceita e descarta. O sintoma é um paciente
  que nunca ganha nome, sem log e sem métrica.
- **Decisão:** exchange `checkin.events` (topic) + fila `cadastro.enriquecer` +
  DLQ `cadastro.enriquecer.dlq`, todas duráveis. `opcoesFilaEnriquecimento()` é
  a fonte única dos argumentos da fila. A fila principal é declarada pelo
  próprio `ServerRMQ`, via `queueOptions` em `connectMicroservice`; a DLQ é
  declarada por `TopologiaEnriquecimento`, no `onApplicationBootstrap`.
- **Alternativas consideradas:**
    - Declarar tudo em `onApplicationBootstrap`: **não funciona.** `queue.bind`
      e `queue.consume` exigem fila existente, e o consumidor começa em
      `startAllMicroservices()`, que roda antes de `listen()`, logo antes de
      qualquer `onApplicationBootstrap`. Foi exatamente o crash observado
      (`NOT_FOUND - no queue 'cadastro.enriquecer'`).
    - `noAssert: true` declarando a fila por fora: o `ServerRMQ` usaria o nome
      sem declarar, mas o bind continua exigindo fila existente. Não remove a
      dependência de ordem, só troca uma falha de execução por outra.
    - Declarar a topologia no compose, fora do app: funciona, mas tira a
      topologia do versionamento e da review, e a faz divergir do código.
    - `emit` (request/reply) em vez de `publish` (fire-and-forget) no publisher:
      `emit` espera a resposta do consumidor, então fila ausente ou consumidor
      parado aparece como erro em vez de descarte silencioso. O custo é o
      acoplamento do ADR 8. Descartado também dentro do teste: `emit` sem
      servidor Nest que responda deixa a promise pendente, e o fechamento do
      canal sob ela estoura um `Channel ended, no reply will be forthcoming` não
      tratado, que o vitest conta como unhandled rejection e faz a suíte sair
      com código de erro apesar de todos os testes passarem.
- **Consequências:**
    - **O broker exige argumentos idênticos a cada declaração da fila.**
      Divergir no `x-dead-letter-exchange` dá 406 PRECONDITION_FAILED e derruba
      o canal. Por isso `opcoesFilaEnriquecimento()` é compartilhado entre a app
      e a função de topologia: se divergirem, a API não sobe.
    - **O teste de topologia tem de ser hermético** Rodar `fila.spec.ts` com a
      API no ar faz o teste passar _e_ subir dados em produção: a fila real está
      bound na routing key de produção, então o consumer real recebe uma cópia
      da mensagem de teste, não acha o paciente fictício, descarta e a cada
      execução a DLQ cresce. Fila exclusiva não impede isso, exclusividade vale
      para consumo, não para publicação. Daí as três decisões do spec:MQ direto
      em vez de `ClientRMQ` (o `ChannelWrapper` não tem `waitForConfirms` e o
      `close()` dele rejeita), exchange e fila próprios do teste, e as asserções
      de produção (binding, `durable`, `x-dead-letter-*`) feitas pela API de
      gerenciamento, em vez de por publicação. Um controle negativo foi incluído
      porque, sem ele, um teste de entrega que é bem sucedido não prova nada: a
      fila de destino poderia estar errada e o teste seguiria verde.
    - **Fila e exchange de teste precisam de `exclusive`/`autoDelete` com
      descarte explícito.** `deleteQueue` sozinho deixa órfã toda vez que o
      teste quebra no meio, e `autoDelete` em exchange só dispara depois que
      existiu binding, o controle negativo nunca vincula nada. Sem isso o broker
      de desenvolvimento acumula lixo a cada execução.
    - **A DLQ não recebe a desistência, mas recebe o crash do handler.** São
      dois caminhos distintos, e a distinção importa:
        - Na terceira tentativa o consumidor só retorna (`return` em
          `tratarFalha`). O handler resolve, e o Nest faz `ack` automático. A
          mensagem some sem registro além do log em `warn`, **essa desistência
          não é recuperável por ninguém.**
        - Se o handler **lança** fora do `try/catch` do enrichimento, o Nest faz
          `nack` sem requeue e o broker dead-letteriza. Foi verificado no
          broker: um payload sem o envelope `{ pattern, data }` deixa a
          desestruturação em `handle` lançar, e a mensagem chega em
          `cadastro.enriquecer.dlq` com `x-death.reason = "rejected"`. É a rede
          contra crash, e ela funciona.

        Ou seja: a topagem da DLQ está correta e exercitada, mas **não** deve
        ser tratada como observabilidade da desistência. Quem precisa saber de
        reprocessamento perdido hoje depende do log.

    - `prefetchCount: 1` dá backpressure de verdade: uma mensagem em voo por
      instância, e o burst contra o mock fica limitado por construção.
    - `wildcards: true` no `ServerRMQ` faz o Nest usar a routing key da mensagem
      como pattern do `@EventPattern`, **e** bindar a fila em cada pattern
      registrado. São dois efeitos no mesmo booleano.

### ADR 11 - ESM com os aliases resolvidos no pós-build

- **Contexto:** o projeto é ESM (`"type": "module"`,
  `moduleResolution: bundler`) e usa alias `@/`. O Node exige caminho relativo
  **com** extensão em `import`, e o TS em modo `bundler` não exige e não emite
  nada que resolva alias. As duas regras colidem: a fonte não pode ter `.js`, e
  o `dist` precisa ter.
- **Decisão:** `scripts/fix-esm-specifiers.mjs` roda **depois** de `nest build`
  e reescreve, só dentro do `dist`: `@/x` vira caminho relativo, e todo import
  relativo ganha `.js`. Nenhum import em `src/` tem extensão.
- **Alternativas consideradas:**
    - `tsconfig.paths` + `tsc-alias`: funciona, mas o `nest build` não roda o
      `tsc-alias`, então depende de alguém lembrar do passo extra.
    - Loader hook do Node (`--import`): resolve em runtime e traria o watch de
      volta sem script nenhum. Descartado porque entra na frente de todo import
      e paga custo de cold start, além de mascarar o problema em vez de buildar
      certo.
    - `dist` em CommonJS: brigaria com `__dirname` e top-level await.
    - Renunciar aos aliases e usar caminhos relativos em tudo: resolve o
      problema, e é o que não fiz porque `@/` é o que torna a árvore navegável.
- **Consequências:**
    - **O build é um script, não um comando.** `pnpm build` é a unidade real de
      build; qualquer caminho novo de execução, `start`, `start:dev`, Docker
      precisa passar por ele. O `Dockerfile` herda isso direto, porque roda
      `pnpm start:dev`.
    - `start:dev` deixou de ser `nest start --watch` e virou `scripts/dev.mjs`,
      que faz build → pós-build → restart do processo. O watch do Nest CLI
      reinicia o app sem passar pelo pós-build, e a API morre com
      `ERR_MODULE_NOT_FOUND`.
    - O script é idempotente: rodar duas vezes não muda nada, o que o torna
      seguro num loop de watch.
    - O `dev.mjs` faz polling de `mtime` em vez de `fs.watch` recursivo, que em
      Linux depende da versão do Node e ainda erra em bind mount de container.

_(Temas sugeridos pelo enunciado que ainda não têm ADR: health checks e
métricas; circuit breaker e cache do cadastro REST, hoje descartados por decisão
no ADR 9.)_

## Segurança & LGPD

_Onde estão os dados sensíveis, riscos de privacidade e mitigações
(trânsito/repouso, logs, retenção, minimização). O que você faria antes de ir
para produção._

## Testes

_Sua estratégia: o que testou, em que nível, e o que conscientemente deixou de
fora._

## Próximos passos rumo a produção

_O que falta e como você evoluiria isto._
