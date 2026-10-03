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
      produção.
    - A volta para o Express é uma linha, então o custo de ter escolhido errado
      é baixo.

_(Temas sugeridos pelo enunciado que ainda não têm ADR: estratégia de
resiliência do cadastro REST — timeout, retry/backoff, circuit breaker, cache —
e o tratamento de `429`; health checks e métricas.)_

## Segurança & LGPD

_Onde estão os dados sensíveis, riscos de privacidade e mitigações
(trânsito/repouso, logs, retenção, minimização). O que você faria antes de ir
para produção._

## Testes

_Sua estratégia: o que testou, em que nível, e o que conscientemente deixou de
fora._

## Próximos passos rumo a produção

_O que falta e como você evoluiria isto._
