# Arquitetura & Decisões — Gabriel Ferraz dos Santos

## Visão geral

Uma API de recepção de check-in em NestJS sobre Fastify e Postgres. O desenho
inteiro gira em torno de uma escolha: **nada que não seja essencial para atender
o paciente está no caminho da request.** O que é enriquecimento vai para fila.

```
   POST /check-ins { cpf }
          |
          v
   +------------------------------------------------+
   |  CheckInController -> CreateCheckIn            |
   |      |                                         |
   |      +-- GetOrCreatePaciente (INSERT, degradado|
   |      |     se o cadastro falhar)               |
   |      |                                         |
   |      +-- HttpAgendamentoAdapter (legado XML)    |
   |      |     -> PRESENTE | AUSENTE | INDISPONIVEL|
   |      |                                         |
   |      +-- $transaction: checkin + outbox_events  |
   |      |                                         |
   |      +---> enfileira { pacienteId, tentativa } |
   |              |                                 |
   |              v                                 |
   |      cadastro.enriquecer  (duravel, prefetch 1)|
   |              |                                 |
   |              v                                 |
   |   CadastroEnriquecimentoConsumidor             |
   |      -> mock de cadastro (~600ms, 10% falha)   |
   |      -> enriquece ou reinsere (max 3)          |
   |      -> 404 = definitivo, descarta sem retry   |
   +------------------------------------------------+
          |
          v
   Postgres: checkins + pacientes + outbox_events + logs (append-only)
          |
          v
   OutboxDispatcher (poll 5s) -> exchange checkin.events (confirmado)
```

Os dois sistemas externos entram em lugares diferentes, e a distinção é
deliberada:

- **Cadastro de pacientes** (mock HTTP, ~600ms, 12% de falha, 5 req/10s por IP):
  consultado pelo consumidor da fila, nunca pela request. A request grava o
  paciente em estado degradado (`cadastroConfirmado = false`) e segue.
- **Legado de agendamento** (XML, ~800ms, falha 10%): consultado dentro da
  request porque os três estados de `statusAgendamento` são o dado, não
  enriquecimento. Ver ADR 4.

O evento de check-in **não** é publicado direto pela request: a `CreateCheckIn`
e as transições gravam o evento em `outbox_events` na mesma `$transaction` do
check-in, e o `OutboxDispatcher` publica depois. Ver ADR 1. O ciclo de vida do
check-in tem quatro eventos de domínio, publicados no mesmo

exchange `checkin.events`: `checkin.created`, `checkin.iniciado`,
`checkin.finalizado` e `checkin.cancelado`. Cada transição é um use case, e as
regras de estado vivem na entidade: `finalizado()` exige `iniciadoEm`, e tanto
`finalizado()` como `cancelar()` são idempotentes quando `finalizadoEm` já
existe. Repetir uma transição devolve `eventoId: null` e não publica de novo.

## Recorte

**Implementado de fato:**

- `POST /check-ins` com CPF, incluindo a proteção de check-in aberto por dia
  (índice parcial único) e o `409` que devolve o `pacienteId` e a
  `dataReferencia` do registro que colidiu.
- As demais rotas de check-in, uma por use case: `GET /check-ins?cpf=`,
  `GET /check-ins/contagem?cpf=`, `GET /check-ins/:checkinId`,
  `POST /check-ins/:checkinId/iniciar`, `POST /check-ins/:checkinId/finalizar` e
  `POST /check-ins/:checkinId/cancelar`.
- Enriquecimento de paciente assíncrono, com retry, descarte de erro permanente
  e pacing para respeitar o rate limit.
- Ciclo de vida do check-in como use cases: `CreateCheckIn`, `StartCheckIn`,
  `FinalizarCheckIn` e `CancelarCheckIn`, com as regras de transição e a
  idempotência garantidas na entidade.
- Publicação dos quatro eventos de check-in, sem dados pessoais no payload.
- Log append-only com `acao` estruturada, `contexto` em jsonb e trigger que
  recusa `UPDATE`/`DELETE`.
- Topologia de mensageria declarativa e verificada contra o broker, com testes
  que publicam de verdade.

**Consultar por CPF é rota, e a tradução é da aplicação.** O totem envia CPF;
para resolver o `pacienteId`, é a função do `ListCheckInsByCpf` e
`CountCheckInsByCpf`, não do controller, que não conversa com repositório. CPF
desconhecido responde `404`, e isso é o que o distingue de paciente cadastrado
sem check-in, que responde `200` com lista vazia e contagem zero.

**Deixado como desenho, deliberadamente:**

- **Circuit breaker e cache do cadastro REST** (ADR 9): o pacing de 2,2s com
  teto de 3 tentativas já resolve o caso prático.
- **Health check existe, métricas não.** O `GET /health` verifica as
  dependências que a request depende (Postgres e broker) e responde `503` quando
  alguma está fora, o que é o minimo para o compose/orquestrador saber quando
  tirar a instância de rota. **Métricas continuam fora:** o enunciado não pede,
  e não quis inventar um formato de telemetria que ninguém vai consumir. O sinal
  hoje é o log estruturado e a profundidade das filas.

**Por que o recorte é esse:** o risco do exercício não é fazer mais, é fazer
pouco e fazer certo. Cada adição extra é uma camada a mais que precisa de teste
e de observabilidade.

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
    - **Um advisory lock transacional serializa os dispatchers.** Cada ciclo
      tenta adquirir a mesma chave com `pg_try_advisory_xact_lock`; só quem
      adquire drena o lote. O lock fica aberto durante a publicação e as
      gravações e é liberado pelo Postgres quando a transação termina. Isso
      evita dois dispatchers ativos publicarem o mesmo lote sem adicionar
      colunas de claim. O custo é manter uma conexão/transação aberta enquanto o
      broker confirma o lote (timeout de 120s).
    - **Ainda é at-least-once.** O publish no RabbitMQ e a atualização no
      Postgres não são uma transação distribuída. Se o processo cair depois da
      confirmação do broker e antes de marcar `publicado_em`, o evento será
      publicado novamente após reiniciar. O consumidor ainda precisa deduplicar
      por `eventId`.
    - O limite de 10 tentativas agora também filtra a consulta pendente. Ao
      atingir o limite, o evento recebe `OUTBOX_DESISTIDO` e sai dos lotes
      ativos; a linha continua no banco, sem ser marcada como publicada, para
      preservar a trilha e permitir investigação manual.
    - **Reconexão do broker:** o `RabbitPublisher` abre a conexão no
      `onModuleInit` e reconecta sozinho em `close`/`error`, com backoff fixo de
      5s. Sem isso, uma queda do broker deixava o dispatcher falhando para
      sempre até reiniciar o processo.

### ADR 2 - Log append-only

- **Contexto:** o dado é sensível (LGPD). Precisamos de rastreabilidade das
  transições da fila e das chamadas às integrações, sem transformar o banco num
  segundo depósito de informações pessoais, como já tem na API legado.
- **Decisão:** tabela `logs` **append-only**, com `acao` enum estruturado no
  lugar de `mensagem` em texto livre, `contexto` em jsonb, e trigger
  `BEFORE UPDATE OR DELETE` que levanta exceção. Sem data de atualização, de
  propósito. O `checkinId` e o `pacienteId` são referência histórica **sem chave
  estrangeira**, e a gravação não trava o fluxo.
- **O que entra em `contexto`:** só identificadores internos e o que explica a
  transição (`de`, `para`, número da tentativa, nome da integração). A entidade
  `RegistroAuditoria` recusa a construção se aparecer uma chave de dado pessoal:
  cpf, cnpj, rg, nome, sobrenome, nascimento, email, telefone, endereço; Em
  qualquer nível de aninhamento, dentro de objetos e de arrays. A regra verifica
  **chaves**, não valores: um CPF solto dentro de `contexto: { cpf }` entra pela
  chave, mas heurística sobre formato de valor geraria falso positivo com um
  campo numérico qualquer e daria falsa segurança.
- **Alternativas consideradas:**
    - Só log em stdout (padrão do Nest): some no restart, não serve como trilha
      de auditoria.
    - Tabela mutável com `updatedAt`: se alguém corrige um log, o rastro perde
      credibilidade.
    - Guardar o payload integral da integração: descartado, o XML do legado e o
      JSON do cadastro possuem informações que contradizem a LGPD (CPF, nome,
      nascimento).
    - FK `ON DELETE SET NULL` para `checkin` e `paciente`: foi o que estava no
      schema, e é impossível de cumprir. `SET NULL` é um `UPDATE`, então o
      trigger bloqueia: apagar um check-in que já tinha log levantava
      `logs são append-only`. O efeito era transformar "não se apaga log" em
      "não se apaga nada", inclusive na limpeza dos testes. Tirar a FK resolve:
      o log sobreviver à entidade observada é exatamente o que um log de
      auditoria precisa fazer.
    - FK `RESTRICT` em vez de nenhuma: preserva a integridade referencial, mas
      deixa o log segurar a entidade viva por um id que já cumpriu seu papel, e
      volta a impossibilitar qualquer rotina de retenção ou de limpeza de teste.
- **Consequências:**
    - `contexto` é jsonb sem schema e pode virar depósito de lixo. Mitigação em
      duas frentes: a guarda de dado pessoal no domínio, que é testada, e o
      `acao` enum, que já diz o que aconteceu, a mensagem em texto livre não
      traria informação que o enum e o `contexto` já não fornecem.
    - Sem FK, `checkinId` pode apontar para um check-in que não existe mais. É o
      comportamento desejado: o log registra o que aconteceu naquele momento, e
      os índices continuam existindo para a consulta por check-in.
    - O direito ao esquecimento pede `DELETE`, e um log que recusa `DELETE` não
      atende. Resolvi da seguinte forma: como o log não guarda informações
      pessoais, ele sobrevive à eliminação do paciente sem persistir o dado.
    - Auditar é _best-effort_ de propósito. A falha de auditoria soa no log da
      aplicação, não na resposta ao paciente.
    - Não existe endpoint para ler os logs. A consulta é feita pelo repositório
      (`findManyByCheckIn` / `findManyByPaciente`), o que evita criar superfície
      HTTP nova sem necessidade.

### ADR 3 - RabbitMQ como topics

- **Contexto:** o README comenta sobre evento por check-in para outros sistemas
  reagirem (painel de senha, notificação da equipe). Precisa de desacoplamento:
  quem publica não conhece quem consome. O broker já vem no `docker-compose.yml`
  (AMQP na porta 5672).
- **Decisão:** topic exchange `checkin.events` e **um canal AMQP dedicado só
  para publicar** (`RabbitPublisher`, ver ADR 12), em vez de `ClientRMQ`. Quatro
  routing keys, uma por evento do ciclo de vida: `checkin.created`,
  `checkin.iniciado`, `checkin.finalizado` e `checkin.cancelado`. Mensagens
  `persistent` e **sem informações pessoais no payload**.
- **Alternativas consideradas:**
    - **MQTT:** era o que o código original usava (`ServerMqtt`). Ficou errado,
      pois o broker expõe AMQP e o plugin `rabbitmq_mqtt` não está habilitado na
      imagem. Caia assim que a primeira conexão acontecia.
    - HTTP/webhook para cada consumidor: acopla a API à disponibilidade de cada
      consumidor, exatamente o que o broker evita.
    - Kafka: é desproporcional para um evento por check-in.
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

### ADR 4 - Status de agendamento com três estados

- **Contexto:** o sistema legado devolve `possuiAgendamento` booleano, mas falha
  com `500` em ~10% das chamadas. O README do legado faz a seguinte pergunta: um
  check-in deveria falhar por completo porque o legado caiu?
- **Decisão:** `statusAgendamento` com `PRESENTE | AUSENTE | INDISPONIVEL`. O
  legado e consultado **dentro da request** do `POST /check-ins`, pelo
  `HttpAgendamentoAdapter`, com `HTTP_TIMEOUT_MS` (5s). O check-in é criado
  mesmo com o legado fora; os dados ficam nulos e o status registra que não deu
  para perguntar.
- **Como o legado e ligado:** `AgendamentoPort` está registrado no
  `CheckInModule` apontando para `HttpAgendamentoAdapter`, e injetado no
  `CreateCheckIn`. O adapter mantém os três estados: `null` = o legado respondeu
  e não há agendamento, erro = o legado falhou de verdade. O `CreateCheckIn`
  traduz: `null` -> `AUSENTE`, retorno com especialidade/medico/horario ->
  `PRESENTE`, exceção -> `INDISPONIVEL`. Os três ramos tem teste unitário.
- **Alternativas consideradas:**
    - Falhar o check-in quando o legado cai: mais simples, mas a recepção perde
      o paciente por causa de um sistema que só faz enriquecimento, CPF e nome
      já vieram do cadastro.
    - Booleano `possuiAgendamento`: confunde não tem agendamento com não deu
      para perguntar. Descartado; é o que o DTO original fazia, vide os commits
      iniciais.
    - `boolean` nullable: funciona, mas a distinção entre não consultou e
      consultou e vazio é perdida, e é mais facil de errar em codigo.
    - Retry no legado até responder: converte 10% de falha em latência.
    - Consulta assíncrona ao legado (enfileirar e enriquecer depois): isola a
      request, mas faz o totem esperar o mesmo tempo quando a fila sobe. Fica
      para a próxima iteração, se o tempo de resposta não aguentar.
- **Consequencias:**
    - Sem `INDISPONIVEL` como default silencioso: o `CreateCheckIn` sempre
      consulta e decide explicitamente, então não dá para criar check-in com
      `AUSENTE` por acidente.
    - Dá para medir a saude da integração contando por status, e virar um
      alerta.
    - CHECK no banco exige `especialidade` e `horario` quando o status e
      `PRESENTE`, o que pega bug de mapeamento na raiz em vez de deixar dado
      passar.
    - Custo: a request espera até 5s pelo legado. Assumido de propósito - o
      balcão precisa da resposta do agendamento para o paciente sair com ela.
    - O que é perdido: o paciente entra sem informação de agendamento. Aceito, a
      recepção consulta o legado por fora se precisar. A degradação é graciosa
      **e explicita**.

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
      coisas, mas são o mesmo evento e adiciona uma coluna e uma segunda entrada
      no CHECK.
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
    - O CHECK ficou mais frouxo, e a entidade ficou mais robusta. É a direção
      certa: o banco é a última linha de defesa.
    - **Os dois CHECKs agora estão duplicados em `CheckIn.validar()`.** Essa
      duplicação é deliberada e cobre a mudança do SQL; o teste de conformidade
      em `checkin.spec.ts` traduz os dois de volta e falha se a entidade
      divergir. Se um dia o SQL mudar, será necessário alterar.
    - `checkins_checkin_aberto_por_dia_unq` não foi afetado: ele filtra por
      `status IN ('AGUARDANDO','EM_ATENDIMENTO')`, e `CANCELADO` nunca entra
      nessa contagem desde a migration anterior.

### ADR 8 - Enriquecimento de paciente fora da requisição

- **Contexto:** `GetOrCreatePaciente` precisa do nome e da data de nascimento do
  paciente, mas o mock de cadastro responde ~600ms, falha ~12% das vezes e
  limita a 5 requisições por 10s por IP. Chamar isso dentro da request custava
  600ms em **toda** recepção e, no pior caso, deixava um erro de terceiro
  decidir se o paciente entra. Como o CPF já vem do cadastro do paciente, o nome
  é _enriquecimento_, não requisito: dá para gravar o paciente primeiro e
  completar depois.
- **Decisão:** a request grava o paciente em estado degradado
  (`cadastroConfirmado = false`) e enfileira `{ pacienteId, tentativa }` na fila
  durável `cadastro.enriquecer`. O payload leva **só o id**, e o consumidor lê o
  paciente do banco. Nenhum dado pessoal no payload (ADR 3). O consumidor é
  idempotente `if (paciente.cadastroConfirmado) return`, então reenfileirar é
  seguro e é o caminho normal.
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
    - **A request deixa de depender dos 600ms do cadastro, e também deixou de
      depender do broker para enfileirar.** A primeira versão enfileirava com
      `ClientRMQ.emit`, que é request/reply: esperava a resposta do consumidor,
      então `emit` sem consumidor estourava a request. Hoje `enfileirar()` é
      fire-and-forget (`RabbitPublisher.publicar`) e o único caminho síncrono é
      o do retry, que espera confirmação do broker com timeout.
    - A degradação virou estado observável em vez de erro:
      `enriquecimentoPendente` no retorno e `cadastroConfirmado` no banco.
    - A entrega é at-least-once, então a idempotência não é opcional
      (consequência herdada do ADR 3).
    - **A fila não melhorou o rate limit.** 5 req/10s por IP continua valendo.
      Quem controla o ritmo é o pacing do consumidor.

### ADR 9 - Resiliência da integração com o cadastro REST

- **Contexto:** mesma situação do ADR 8: dependência externa lenta e instável. O
  enunciado pergunta o que fazer quando ela cai, e a resposta para o caso foi
  "continuar e sinalizar".
- **Decisão:** timeout explícito (`HTTP_TIMEOUT_MS` via `AbortSignal`) e falha
  classificada em três erros de domínio, porque eles têm consumidores
  diferentes: `CadastroRateLimitado` (429), `CadastroIndisponivel` (5xx e
  timeout) e `PacienteNaoEncontrado` (404). As duas primeiras valem retry; a
  terceira é definitiva. O ritmo é imposto no cliente, `prefetchCount: 1` e
  intervalo mínimo de 2200ms entre chamadas, em vez de tentar negociar com o
  mock.
- **Alternativas consideradas:**
    - Sem timeout: herda o default do axios, que pode passar de minutos e segura
      uma conexão do pool.
    - Retry exponencial com jitter: é a escolha certa para falha transitória em
      geral, mas aqui existe um limite artificial e determinístico; backoff
      multiplicaria tentativas.
    - Confiar no rate limit do servidor e ir no máximo: com limite de 5 por 10s,
      o quinto check-in leva a resposta com 429 e vira retry.
    - **Circuit breaker:** descartado por ora. Com pacing de 2,2s, teto de 3
      tentativas e reenfileiramento, o ganho é pequeno e o custo é um estado a
      mais
    - **Cache de resposta do cadastro:** descartado. O dado praticamente não
      muda.
- **Consequencias:**
    - O pacing e por instância. Duas replicas dividida por 2,2s cada uma somam
      mais que o pretendido.
    - Erro inesperado no adapter **não** vira retry: vira log e paciente
      degradado
    - **`PacienteNaoEncontrado` é definitivo e não é reenfileirado.** O
      consumidor trata esse erro num ramo próprio, antes do bloco de retry:
      audita `INTEGRACAO_FALHOU` com `defetivo: true` e devolve `descartado` com
      motivo `cpf-desconhecido`. Isso importa por causa do rate limit do mock:
      cada retry de um 404 gastava uma das 5 requisições por 10s, e dez retries
      de um paciente que simplesmente não existe não mudam a resposta. Teste
      unitario cobre: 404 -> descartado, zero reenfileiramentos.

- **Contexto:** no ADR 3 eu documentei o lado do publisher. O lado do consumidor
  tem uma armadilha que só aparece em produção: com `wildcards: true`, o
  `ClientRMQ` declara **só o exchange** e nunca cria fila nem binding
  (client-rmq.ts, ramo `else` de `setupChannel`). Publicar em exchange sem fila
  bindada **não dá erro**, o broker aceita e descarta. O resultado é um paciente
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
      topologia do versionamento e da review e faz ela divergir do código.
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
      gerenciamento, em vez de por publicação.
    - **Fila e exchange de teste precisam de `exclusive`/`autoDelete` com
      descarte explícito.** `deleteQueue` sozinho deixa órfã toda vez que o
      teste quebra no meio, e `autoDelete` em exchange só dispara depois que
      existiu binding, o controle negativo nunca vincula nada. Sem isso o broker
      de desenvolvimento acumula dados desnecessários a cada execução.
- **A DLQ não recebe a desistência, mas recebia o crash do handler** Com
  `noAck: true` (ADR 12) o broker trata a mensagem como entregue no instante da
  entrega, então não existe `ack`, nem `nack` para dar: crash no handler
  descarta a mensagem silenciosamente. Verifiquei no broker: publiquei um
  payload sem o envelope `{ pattern, data }`, que fazia a desestruturação
  lançar, e `cadastro.enriquecer.dlq` continuou em zero.

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

### ADR 12 - `noAck: true` e um canal só para publicar

- **Contexto:** a fila `cadastro.enriquecer` travava. O sintoma era uma fila com
  mensagens que nunca baixavam, `messages_unacknowledged` crescendo, e o log
  parava depois da primeira tentativa de enriquecimento. Como
  `prefetchCount: 1`, bastava **uma** mensagem presa para travar o consumidor
  inteiro, e nenhuma outra entrava.
- **Causa raiz:** com `noAck: false`, o `ServerRMQ` entrega a mensagem e espera
  um `ack` que não vinha. `handleEvent` do Nest só confirma o recebimento quando
  o `RmqContext` chega ao handler, e com `@EventPattern` sem parâmetro de
  contexto esse objeto não existe, logo nunca havia `ack`. Não era configuração
  de ack: era ausência de ack. Cada mensagem ficava presa para sempre. Já tinha
  tentado `ack()` manual, o que produzia `Channel closed` na hora seguinte.
- **Decisão:** `noAck: true` em `connectMicroservice`, e um `RabbitPublisher`
  com canal dedicado para publicação fire-and-forget, no lugar do
  `ClientRMQ.emit` nos dois caminhos de enfileiramento.
- **Alternativas consideradas:**
    - `ack()` manual no handler: é a resposta óbvia e não funciona. O Nest já
      gerencia o canal e o ack manual fecha o canal sob os pés do consumidor.
    - `noAck: true` e continuar com `ClientRMQ.emit`: resolve o travamento, mas
      `emit` é request/reply e cria fila de resposta por mensagem (`amq.gen-*`).
      Com `emit` esperando um consumidor que não responde, o publisher pode se
      auto-travar esperando a si mesmo.
    - Voltar para `noAck: false` e usar `RpcPattern` com reply: troca o problema
      pelo ADR 1: acopla a request ao consumidor, que é exatamente o que o
      desenho da fila queria evitar.
- **Consequências:**
    - **A entrega passou a ser at-most-once no broker.** Com `noAck: true` não
      há redelivery: se o processo morre no meio do handler, a mensagem se foi.
      A tolerância a falha continua existindo, mas no nível da aplicação
      (reenfileiramento com `tentativa`), não no broker. Ver a consequência
      equivalente no ADR 10 sobre a DLQ.
    - `publicarOuFalhar` espera `waitForConfirms` antes de reenfileirar, então o
      retry não se perde num canal morto. `publicar` é fire-and-forget e engole
      falha: quem chama no caminho da request não pode tratar erro de broker
      como erro de negócio.
    - **O envelope é `{ pattern, data }` e não leva `id`.** Sem `id`, o Nest não
      cria fila de resposta, e `emit` nunca é usado. O teste
      `rabbit-publisher.spec.ts` fixa esse formato como contrato.
    - O teste de compatibilidade sobe um `ServerRMQ` de verdade, com fila
      nomeada explicitamente. Nomear a fila é o que torna o teste hermético: sem
      `queue`, o Nest usa o default e o broker gera `amq.gen-*`, e aí o teste
      precisa adivinhar qual fila é a dele procurando "qualquer fila nova com
      consumidor", o que dá falso positivo quando outro teste sobe consumidor em
      paralelo. Foi o que causou uma falha intermitente antes de o nome ser
      explícito.

## Segurança & LGPD

**Onde estão os dados sensíveis.** O CPF é o único dado pessoal que entra na
request (`POST /check-ins`). Nome e data de nascimento vêm do mock de cadastro e
moram em `pacientes`. Não há CPF, nome ou nascimento em nenhum evento, em nenhum
log e em nenhuma fila.

**Minimização como regra de projeto.**

- O payload da fila `cadastro.enriquecer` leva **só** `pacienteId` e
  `tentativa`. Quem enfileira não conhece o CPF, e o consumidor lê o paciente do
  banco. Se o payload levasse o CPF, a fila viraria um segundo depósito de dado
  pessoal com retenção e backup próprios.
- Os quatro eventos de check-in levam `checkinId`, `pacienteId` e `status`.
  `pacienteId` é uuid interno: identifica sem revelar.
- O `contexto` jsonb do log referencia `checkinId`, e não carrega o payload do
  paciente nem o corpo da resposta de terceiro. Foi decisão explícita no ADR 2.

**Log append-only.** `logs` tem trigger que recusa `UPDATE` e `DELETE`, então a
trilha não pode ser reescrita por bug ou por alguém com pressa. Isso é o oposto
de um log mutável, e é o motivo de o log referenciar id em vez de copiar dado.
Nenhuma chave estrangeira aponta para `logs`, e as duas que apontavam para ele
saíram: `SET NULL` é um `UPDATE`, e o trigger o bloqueia.

**O que isso custou em correção.** A primeira versão logava o CPF: o
`HttpCadastroAdapter` imprimia `cpf=${cpf}` no warning de HTTP, e o consumidor
imprimia o CPF do paciente quando o cadastro não conhecia. Isso contrariava o
que esta seção afirma, então foi corrigido: os dois logs passaram a dizer so o
que precisa (`cadastro respondeu 503`, `cadastro não conhece o pacienteId=...`)
e a mensagem do `PacienteNaoEncontrado` não coloque mais o CPF. Vale registrar
porque o erro é facil de reintroduzir: um `logger.warn` com a variável do
request na mão e o caminho mais curto para vazar dado sensível.

**Retenção e eliminação.** O log não guarda informação pessoal, então sobrevive
a eliminação do paciente sem persistir o dado: o `pacienteId` fica como
referência histórica e o paciente pode ser apagado normalmente. É a resposta que
dei ao direito ao esquecimento dentro do que o ADR 2 permite, e a lacuna
assumida é que a existência do check-in continua visível depois da eliminação do
paciente. Num ambiente real eu trataria isso com uma retenção por prazo, que não
existe ainda.

**O que eu faria antes de produção.**

1. TLS no broker e na API. Hoje é `amqp://` e HTTP puro em rede local; em
   produção o payload trafega CPF pela rede e isso não pode continuar.
2. Criptografia em repouso no volume do Postgres, para o caso de o backup ser
   extraído.
3. Retenção por prazo no `logs`, com o que fica e o que sai decidido antes, e
   não por volume.
4. Auditoria de acesso ao CPF: quem pediu o quê, porque hoje o único rastro é o
   log de transição, não o de leitura.
5. Remover o CPF dos logs de acesso do HTTP ingress antes que ele vire o
   depósito de dado pessoal que o ADR 2 recusou.

## O front

O frontend React/Vite tem dois fluxos distintos, compostos com os componentes
COSS UI e conectados com Ky e TanStack Query:

- **Totem (`/`)**: coleta o CPF e chama `POST /check-ins`. Exibe confirmação
  quando o registro é criado e orienta o paciente a aguardar a recepção. Se já
  houver check-in aberto (`409`), orienta procurar a equipe.
- **Recepção (`/recepcao`)**: consulta pelo CPF via `GET /check-ins?cpf=`,
  mostra status do check-in e do agendamento e permite iniciar, finalizar ou
  cancelar. A consulta atualiza a cada 15 segundos e também pode ser atualizada
  manualmente.

**Limites do contrato atual:** a API não oferece fila global nem autenticação.
Assim, a tela da recepção acompanha o histórico do paciente pesquisado, não a
fila de toda a unidade; os indicadores também são restritos a esse paciente. O
nome pode ainda não estar disponível enquanto o enriquecimento assíncrono está
pendente. Não há testes automatizados de interface neste recorte.

## Testes

**Estratégia.** Testar contra as peças reais onde a falha seria silenciosa, e
contra fakes onde a dependência é irrelevante. O critério: se o teste pode
passar com a integração quebrada, ele não vale.

**Testes unitários e de adapter (19 arquivos `*.spec.ts`):**

- Entidades e use cases com repositório e porta de eventos em memória: transição
  de estado, idempotência, `404`, pré-condição de início e ausência de
  publicação quando o save falha. Os quatro use cases de check-in estão
  cobertos, incluindo a asserção explícita de que a repetição **não** publica um
  segundo evento, e de que a repetição também **não** audita.
- `registro-auditoria.spec.ts` cobre a guarda de dado pessoal: recusa cpf, nome,
  nascimento, email e telefone, tanto em chave direta quanto aninhados em objeto
  ou dentro de array.
- `prisma-auditoria.repository.spec.ts` cobre a garantia de _best-effort_: um
  `create` que falha, inclusive por violação de chave estrangeira, resolve sem
  lançar. É o teste que sustenta a promessa de que o log não derruba o fluxo.
- `cadastro-enriquecimento.consumidor.spec.ts` cobre a máquina de estados do
  consumidor: `enriquecido`, `adiado` com contagem de tentativa, `desistido` em
  `MAX_TENTATIVAS`, `descartado` para paciente inexistente e CPF desconhecido.
- `fila.spec.ts` verifica a topologia pela API de gerenciamento em vez de por
  publicação, com um controle negativo, porque um teste de entrega que dá certo
  não prova nada se a fila de destino puder estar errada.
- `http-agendamento.adapter.spec.ts` cobre sucesso XML, walk-in, XML inválido,
  timeout e falha HTTP. Uma resposta que afirma `possuiAgendamento=true` mas
  omite especialidade, médico ou horário é tratada como indisponível, não como
  walk-in.
- `saude.service.spec.ts` verifica a composição das checagens de dependência; e
  `errors.spec.ts` protege as mensagens dos erros do cadastro contra vazamento
  de CPF.
- `outbox-dispatcher.spec.ts` verifica que só a instância que adquire o advisory
  lock processa o lote; `prisma-outbox.repository.spec.ts` verifica que eventos
  no limite de tentativas deixam de entrar nos lotes ativos.
- Os testes de `fila.spec.ts` e `rabbit-publisher.spec.ts` usam RabbitMQ real;
  `fila.spec.ts` também consulta a API de gerenciamento. O job de qualidade do
  CI sobe um broker com management para executá-los.

**Testes e2e (6 arquivos `*.e2e-spec.ts`)**, contra Postgres e RabbitMQ:

- `check-in.e2e-spec.ts` cria check-in real e verifica persistência,
  enriquecimento, `409` com o `pacienteId` e `dataReferencia` do registro que
  colidiu, e duplicidade no mesmo dia.
- `check-in-rotas.e2e-spec.ts` percorre o ciclo de vida inteiro pela HTTP, uma
  rota por vez. É o arquivo que fixa o contrato: `404` para CPF desconhecido e
  para check-in inexistente, `400` para CPF mal formatado e para id que não é
  UUID, `409` com o `statusAtual` no corpo ao tentar iniciar um check-in
  cancelado ou finalizar um que nunca começou, `200` com `eventoId: null` na
  repetição de uma transição idempotente, e o par lista/contagem por CPF. Os
  arquivos e2e rodam com `fileParallelism: false`: todos apontam para o mesmo
  banco, e um teste que conta check-ins globalmente quebra se outro arquivo
  inserir em paralelo.
- `logs.e2e-spec.ts` é a prova de que o log é append-only de verdade, contra o
  banco: confirma que `POST /check-ins` grava `CHECKIN_CRIADO` ligado ao
  check-in, que nenhum contexto carrega CPF ou nome, que a coluna `mensagem` não
  existe mais, e que `UPDATE` e `DELETE` no log são recusados com
  `logs são append-only`. O último teste relê a linha depois da tentativa e
  confere que ela continua intacta, porque "o comando falhou" não é o mesmo que
  "o dado continua igual".
- `prisma-checkin-repository.e2e-spec.ts` confere a query real contra o schema,
  incluindo os três estados do `statusAgendamento` e o CHECK do ciclo de vida.
- `saude.e2e-spec.ts` confirma `200` com Postgres e RabbitMQ disponíveis e `503`
  quando o broker é reportado indisponível, preservando o estado do Postgres na
  resposta.
- `rabbit-publisher.spec.ts` sobe um `ServerRMQ` de verdade e verifica que o
  envelope é `{ pattern, data }`, sem `id`, `persistent`, e que o handler recebe
  a payload. **Foi este teste que reprovou de forma intermitente** durante o
  desenvolvimento; a causa e a correção estão no ADR 12.

**Verificação manual no broker, porque não cabe em teste.** Confirmei no broker
real que os quatro routing keys entregam o payload esperado, que a fila
`cadastro.enriquecer` volta a zero depois do enriquecimento e que
`cadastro.enriquecer.dlq` fica vazia. Também confirmei o comportamento
contrário: com `noAck: true`, um payload mal formatado **não** chega à DLQ. É a
consequência registrada no ADR 10, e ela só apareceu porque o broker foi
inspecionado, não porque um teste falhou.

**O que deixei conscientemente de fora.**

- Teste de concorrência real sobre o índice de check-in aberto. Verifiquei o
  conflito por requisição sequencial, que é o caminho do usuário;
- Teste de carga. O pacing de 2,2s foi justificado por leitura do rate limit,
  não por medição sob pressão.
- Teste de que o log sobrevive à eliminação do paciente. O `logs.e2e-spec.ts`
  prova que o log não impede o `DELETE` do check-in, foi o que a remoção da FK
  resolveu, mas não há cenário que apague paciente e confira o log sobrevivente,
  porque não há endpoint nem rotina que apague paciente em produção ainda.
- `fila.spec.ts` e a API no ar no mesmo instante: é o problema de hermeticidade
  de que comentei no ADR 10. O spec é feito para rodar com o broker

## Próximos passos rumo a produção

1. **Devolver a DLQ ao que ela devia fazer**, ou removê-la. Com `noAck: true`
   ela é inalcançável (ADR 10). As duas saídas são defensáveis; o que não é
   defensável é deixar a topologia prometendo uma garantia que não existe.
2. **Redelivery com garantia.** `noAck: true` trocou travamento por perda em
   crash. O caminho é confirmação manual feita corretamente, e a forma correta
   nesse arranjo é um `Channel` próprio por mensagem ou um consumer que gerencia
   o próprio ack, a ser testado contra o broker, não deduzido.
3. **Metricas.** Profundidade de fila, taxa de `desistido`, tempo de
   enriquecimento, taxa de 429 do cadastro e quantos eventos estao pendentes na
   outbox. O `/health` já dá o básico de dependência; falta o número de negócio.
   Log estruturado não é métrica.
4. **Rotinas de pacing do rate limit.** O pacing é por instância; com duas
   réplicas, o intervalo efetivo cai pela metade (ADR 9). Coordenador único ou
   consumo serializado resolvem.
5. **Circuit breaker no cadastro**, quando o erro sustentado justificar o estado
   extra (ADR 9).
