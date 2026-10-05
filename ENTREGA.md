# Entrega — Gabriel Ferraz dos Santos

## Como rodar

Com Docker Compose disponível, na raiz do repositório:

```bash
docker compose up --build -d
```

O Compose sobe banco, broker, cadastro REST, legado XML, API e frontend. A
imagem da API aplica as migrations com `prisma migrate deploy` antes de iniciar
o servidor.

- Totem do paciente: <http://localhost:5173/>
- Painel da recepção: <http://localhost:5173/recepcao>
- API: <http://localhost:3000>
- Estado das dependências da API: <http://localhost:3000/health>

Para executar a API ou o frontend fora dos containers, consulte os READMEs de
[`api/`](api/README.md) e [`web/`](web/README.md). O `.env.example` da API
mostra os endereços de desenvolvimento local.

## O que está pronto

- O paciente informa o CPF no totem; a API registra o check-in e a interface
  confirma a chegada.
- O legado XML é consultado durante a criação. O check-in continua mesmo se o
  legado falhar, com o estado `INDISPONIVEL`.
- A recepção consulta os check-ins de um paciente e pode iniciar, finalizar ou
  cancelar cada registro conforme o estado atual.
- O cadastro REST enriquece os dados em segundo plano. Rate limit e falhas
  transitórias são reenfileirados; CPF não encontrado é descartado sem retry.
- A criação do check-in e o evento correspondente são persistidos na mesma
  transação via outbox. Eventos não incluem CPF ou nome.
- A trilha de auditoria é append-only e evita dados pessoais no contexto.
- `GET /health` reporta o estado do Postgres e do RabbitMQ.
- O GitHub Actions executa qualidade, build, testes unitários e testes e2e com
  serviços de apoio.

## O que ficou fora do recorte

- Autenticação e autorização da recepção.
- Consulta de uma fila global da unidade; a API e o painel operam por CPF.
- Métricas de negócio e monitoramento além do endpoint de health e dos logs.
- Entrega exactly-once dos eventos: o lock evita dispatchers simultâneos, mas
  ainda pode haver duplicata se o processo cair depois do publish confirmado e
  antes de persistir `publicado_em`. Consumidores devem deduplicar por
  `eventId`. Eventos com 10 falhas saem dos lotes ativos e ficam persistidos
  para investigação.
- Redelivery do consumidor RabbitMQ após crash do handler: com `noAck: true`, a
  mensagem já entregue não é reenviada e a DLQ não cobre esse caso.

As decisões e os trade-offs estão detalhados em
[`ARQUITETURA.md`](ARQUITETURA.md).

## Como testar e observar falhas

Na pasta `api/`, com os serviços externos e o banco disponíveis:

```bash
pnpm test src
pnpm test:e2e
pnpm typecheck
pnpm lint
```

Os testes unitários usam fakes e não precisam do broker ou do banco. Os e2e
precisam de Postgres, RabbitMQ, cadastro REST e legado XML; o arquivo `api/.env`
deve apontar para essas dependências e as migrations devem estar aplicadas. Os
e2e rodam sem paralelismo porque compartilham o banco.

Os serviços de desafio simulam falhas aleatórias: cadastro com latência, `503` e
`429` acima de cinco chamadas em dez segundos por IP; legado com latência e
`500` intermitente. Os testes dos adapters também simulam respostas de sucesso,
timeout e erro de forma determinística.

## Diferenciais implementados

- Outbox transacional e publicação confirmada no RabbitMQ.
- Reconexão do publisher ao broker com intervalo fixo de cinco segundos.
- CORS configurável pela variável `WEB_ORIGIN` e API preparada para migrations
  no boot da imagem.
- CI separado em validação da API e testes e2e com infraestrutura real.
