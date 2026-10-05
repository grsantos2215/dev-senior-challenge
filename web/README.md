# Interface da recepção

Frontend React + Vite com duas telas separadas: o totem do paciente em `/` e o
painel da recepção em `/recepcao`. Os controles visuais usam os componentes COSS
UI presentes em `src/components/ui`.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

Por padrão, a interface chama a API em `http://localhost:3000`. Para apontar
para outra instância, defina `VITE_API_URL` antes de iniciar o Vite. A API deve
permitir a origem do frontend por CORS (`WEB_ORIGIN`, por padrão
`http://localhost:5173`).

O `docker-compose.yml` define essas duas variáveis para as portas publicadas
(`VITE_API_URL=http://localhost:3000` e `WEB_ORIGIN=http://localhost:5173`).
O endereço do frontend é usado no navegador, por isso aponta para `localhost`
do host e não para o nome interno `api` da rede Docker.

## Fluxos disponíveis

- **Totem (`/`)**: o paciente informa o CPF e registra a chegada; a tela confirma
  que o check-in foi enviado à recepção.
- **Recepção (`/recepcao`)**: a equipe busca o histórico pelo CPF e pode criar
  um check-in, iniciar, finalizar ou cancelar conforme o estado atual.
- A fila consultada pela recepção atualiza automaticamente a cada 15 segundos e
  também pode ser atualizada manualmente.

O backend ainda não expõe uma rota de fila global nem de autenticação. Por isso,
esta tela opera sobre o paciente consultado e não representa contagens globais
da unidade.
