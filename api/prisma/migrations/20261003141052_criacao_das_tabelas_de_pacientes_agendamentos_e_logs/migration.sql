-- CreateTable
CREATE TABLE "Agendamento" (
    "id" UUID NOT NULL,
    "medico" TEXT,
    "especialidade" TEXT NOT NULL,
    "data_agendamento" TEXT NOT NULL,
    "horario" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "paciente_id" UUID NOT NULL,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "data_nascimento" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" UUID NOT NULL,
    "mensagem" TEXT NOT NULL,
    "ip" TEXT,
    "hostname" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "agendamento_id" UUID,
    "paciente_id" UUID,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "Agendamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
