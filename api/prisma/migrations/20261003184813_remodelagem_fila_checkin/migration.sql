/*
  Warnings:

  - You are about to drop the `Agendamento` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Log` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Paciente` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "StatusCheckin" AS ENUM ('AGUARDANDO', 'EM_ATENDIMENTO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('PRESENTE', 'AUSENTE', 'INDISPONIVEL');

-- CreateEnum
CREATE TYPE "AcaoLog" AS ENUM ('CHECKIN_CRIADO', 'CHECKIN_STATUS_ALTERADO', 'CADASTRO_CONSULTADO', 'AGENDAMENTO_CONSULTADO', 'INTEGRACAO_FALHOU');

-- DropForeignKey
ALTER TABLE "Agendamento" DROP CONSTRAINT "Agendamento_paciente_id_fkey";

-- DropForeignKey
ALTER TABLE "Log" DROP CONSTRAINT "Log_agendamento_id_fkey";

-- DropForeignKey
ALTER TABLE "Log" DROP CONSTRAINT "Log_paciente_id_fkey";

-- DropTable
DROP TABLE "Agendamento";

-- DropTable
DROP TABLE "Log";

-- DropTable
DROP TABLE "Paciente";

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL,
    "cpf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "data_nascimento" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "status" "StatusCheckin" NOT NULL DEFAULT 'AGUARDANDO',
    "data_referencia" DATE NOT NULL,
    "paciente_id" UUID NOT NULL,
    "status_agendamento" "StatusAgendamento" NOT NULL DEFAULT 'INDISPONIVEL',
    "especialidade" TEXT,
    "medico" TEXT,
    "horario" TIME,
    "iniciado_em" TIMESTAMP(3),
    "finalizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicado_em" TIMESTAMP(3),
    "checkin_id" UUID NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" UUID NOT NULL,
    "acao" "AcaoLog" NOT NULL,
    "mensagem" TEXT NOT NULL,
    "contexto" JSONB,
    "ip" TEXT,
    "hostname" TEXT,
    "checkin_id" UUID,
    "paciente_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_cpf_key" ON "pacientes"("cpf");

-- CreateIndex
CREATE INDEX "checkins_status_data_referencia_criado_em_idx" ON "checkins"("status", "data_referencia", "criado_em");

-- CreateIndex
CREATE INDEX "checkins_paciente_id_data_referencia_idx" ON "checkins"("paciente_id", "data_referencia");

-- CreateIndex
CREATE INDEX "outbox_events_checkin_id_idx" ON "outbox_events"("checkin_id");

-- CreateIndex
CREATE INDEX "logs_checkin_id_idx" ON "logs"("checkin_id");

-- CreateIndex
CREATE INDEX "logs_paciente_id_idx" ON "logs"("paciente_id");

-- CreateIndex
CREATE INDEX "logs_criado_em_idx" ON "logs"("criado_em");

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_checkin_id_fkey" FOREIGN KEY ("checkin_id") REFERENCES "checkins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_checkin_id_fkey" FOREIGN KEY ("checkin_id") REFERENCES "checkins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Abaixo o Prisma nao sabe modelar. Precisamos de SQL na mao.
-- Atencao: o Prisma tambem nao versiona estes objetos. Um `migrate dev` futuro
-- pode reportar drift; nao remova as constraints para "limpar" o drift.
-- ---------------------------------------------------------------------------

-- Idempotencia: um paciente nao pode ter dois check-ins abertos no mesmo dia.
-- E o que impede que um retry do POST de check-in duplique a fila.
CREATE UNIQUE INDEX "checkins_checkin_aberto_por_dia_unq"
  ON "checkins" ("paciente_id", "data_referencia")
  WHERE "status" IN ('AGUARDANDO', 'EM_ATENDIMENTO');

-- Coerencia do ciclo de vida: os timestamps precisam concordar com o status.
ALTER TABLE "checkins"
  ADD CONSTRAINT "checkins_ciclo_de_vida_chk" CHECK (
    ("status" = 'AGUARDANDO'   AND "iniciado_em" IS NULL     AND "finalizado_em" IS NULL)
    OR
    ("status" = 'EM_ATENDIMENTO' AND "iniciado_em" IS NOT NULL AND "finalizado_em" IS NULL)
    OR
    ("status" IN ('FINALIZADO', 'CANCELADO') AND "iniciado_em" IS NOT NULL AND "finalizado_em" IS NOT NULL)
  );

-- Se o legado respondeu que ha agendamento, os dados precisam vir preenchidos.
-- Evita gravar "PRESENTE" com especialidade vazia por bug de mapeamento.
ALTER TABLE "checkins"
  ADD CONSTRAINT "checkins_agendamento_presente_chk" CHECK (
    "status_agendamento" <> 'PRESENTE'
    OR ("especialidade" IS NOT NULL AND "horario" IS NOT NULL)
  );

-- Outbox: o dispatcher so enxerga o que ainda nao foi publicado.
CREATE INDEX "outbox_events_pendentes_idx"
  ON "outbox_events" ("criado_em")
  WHERE "publicado_em" IS NULL;

-- Log e append-only: nenhuma linha pode ser alterada depois de inserida.
CREATE OR REPLACE FUNCTION "logs_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'logs sao append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logs_append_only_trg"
  BEFORE UPDATE OR DELETE ON "logs"
  FOR EACH ROW EXECUTE FUNCTION "logs_append_only"();
