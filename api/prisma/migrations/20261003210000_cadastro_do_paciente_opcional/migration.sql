-- Cadastro do paciente passa a ser opcional.
--
-- Sem isso, o mock de cadastro (503 em ~12% das chamadas, mais rate limit de
-- 5 req/10s por IP) podia derrubar o check-in inteiro: `nome` e
-- `data_nascimento` eram NOT NULL, entao nao havia como registrar o paciente
-- so com o CPF quando a integracao falhava.
--
-- A degradacao segue o spirit do ADR 4 (graciosa e explicita): o paciente
-- entra com `nome IS NULL`, que e o sinal de que o cadastro ainda nao foi
-- confirmado, e o check-in segue. Isso exige que nada downstream trate
-- `nome` como garantido.
ALTER TABLE "pacientes"
    ALTER COLUMN "nome" DROP NOT NULL,
    ALTER COLUMN "data_nascimento" DROP NOT NULL;