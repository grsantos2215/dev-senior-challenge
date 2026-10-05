# API de check-in

API NestJS/Fastify para registrar check-ins, consultar o agendamento no legado
XML e operar os estados da fila. O desenho, os limites e as decisões estão em
[`ARQUITETURA.md`](../ARQUITETURA.md).

## Subir com Docker Compose

Na raiz do repositório:

```bash
docker compose up --build -d
```

O Compose inicia Postgres, RabbitMQ, os serviços externos, API e frontend. A
imagem da API executa `prisma migrate deploy` antes de iniciar o servidor.

- Totem: <http://localhost:5173/>
- Recepção: <http://localhost:5173/recepcao>
- API: <http://localhost:3000>
- Health: <http://localhost:3000/health>

## Rodar a API fora do container

Suba apenas as dependências pelo Compose e, no diretório `api`, configure o
ambiente e instale as dependências:

```bash
docker compose up -d db broker mock-service legacy-service
cd api
cp .env.example .env
pnpm install
pnpm prisma migrate deploy
pnpm start:dev
```

`start:dev` compila e corrige os specifiers ESM antes de reiniciar a API.
Dentro da rede Docker, os endereços são `db`, `broker`, `mock-service` e
`legacy-service`; fora dela, use `localhost` e as portas publicadas.

## Configuração

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Conexão PostgreSQL. |
| `BROKER_URL` | Sim | Conexão AMQP com RabbitMQ. |
| `CADASTRO_URL` | Sim | Base HTTP do cadastro REST. |
| `AGENDAMENTO_URL` | Sim | Base HTTP do serviço legado XML. |
| `HTTP_TIMEOUT_MS` | Não (`5000`) | Timeout dos dois adapters HTTP. |
| `CADASTRO_INTERVALO_MIN_MS` | Não (`2200`) | Espaçamento mínimo entre chamadas ao cadastro pelo consumidor. |
| `OUTBOX_INTERVAL_MS` | Não (`5000`) | Intervalo de polling do outbox. |
| `OUTBOX_LOTE` | Não (`20`) | Limite de eventos lidos por ciclo. |
| `WEB_ORIGIN` | Não (`http://localhost:5173`) | Origem liberada por CORS. |

## Rotas

```text
POST /check-ins                       cria check-in a partir do CPF
GET  /check-ins?cpf=...               lista os check-ins do paciente
GET  /check-ins/contagem?cpf=...      conta os check-ins do paciente
GET  /check-ins/:checkinId            consulta um check-in
POST /check-ins/:checkinId/iniciar    inicia o atendimento
POST /check-ins/:checkinId/finalizar  finaliza o atendimento
POST /check-ins/:checkinId/cancelar   cancela o check-in
GET  /health                          verifica Postgres e RabbitMQ
GET  /                                rota padrão do NestJS (Hello World)
```

`GET /health` responde `200` quando as dependências verificadas estão
disponíveis e `503` quando alguma está indisponível. Ainda não há métricas de
negócio nem uma rota de fila global.

O `POST /check-ins` chama o legado XML dentro da request. O resultado é guardado
em `statusAgendamento`: `PRESENTE`, `AUSENTE` ou `INDISPONIVEL`. Uma falha do
legado não impede a criação do check-in. O cadastro REST é enriquecido de forma
assíncrona; um `404` do cadastro é definitivo e não é reenfileirado.

## Testes e qualidade

```bash
pnpm test src      # unitários, sem infraestrutura
pnpm test:e2e      # requer Postgres, RabbitMQ e serviços mock
pnpm typecheck
pnpm lint
```

Os e2e compartilham banco e rodam sem paralelismo. O GitHub Actions executa
typecheck, lint, testes unitários e build; um job separado sobe Postgres,
RabbitMQ e os mocks para os testes e2e.

## Limites conhecidos

- A API não tem autenticação e não expõe uma fila global.
- Os consumidores dos eventos precisam deduplicar pelo `eventId`.
- O dispatcher do outbox serializa réplicas com um advisory lock do Postgres.
  Ainda há a janela at-least-once entre confirmar no RabbitMQ e marcar o evento
  como publicado; consumidores precisam deduplicar pelo `eventId`. Eventos que
  atingem 10 falhas saem dos lotes ativos e ficam no banco para investigação.
- O consumidor RabbitMQ usa `noAck: true`; a fila de dead letter não recebe uma
  mensagem se o processo cair durante o handler. Ver ADR 10 e ADR 12.
