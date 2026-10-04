-- O log deixa de ter FK para `checkins` e `pacientes`.
--
-- Com o trigger append-only, `ON DELETE SET NULL` nunca podia funcionar: apagar
-- um check-in disparava um UPDATE em `logs` e o trigger levantava
-- 'logs sao append-only'. Na pratica, um check-in com log ficava imposible de
-- apagar -- inclusive na limpeza dos testes e2e.
--
-- Tirar a FK resolve os dois problemas de uma vez. O id no log e referencia
-- historica, nao relacao viva: o log precisa sobreviver ao check-in e ao
-- paciente, e nenhuma das duas entidades pode ser apagada por causa de um log.
-- Os indices continuam, porque a consulta por check-in continua sendo o caso de
-- uso que importa.
ALTER TABLE "logs" DROP CONSTRAINT "logs_checkin_id_fkey";
ALTER TABLE "logs" DROP CONSTRAINT "logs_paciente_id_fkey";