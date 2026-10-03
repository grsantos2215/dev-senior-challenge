-- CANCELADO passa a ser um estado terminal independente de inicio.
--
-- A versao anterior exigia "iniciado_em IS NOT NULL" para FINALIZADO e
-- CANCELADO. Isso obrigava a entidade a carimbar um horario de inicio em um
-- check-in que nunca foi atendido: paciente foi embora da fila, e ainda assim
-- o registro dizia que ele tinha chegado.
--
-- A regra agora: quem foi atendido precisa de inicio e fim; quem cancelou
-- precisa so do fim. Isso separa dado falso de dado vero.
ALTER TABLE "checkins" DROP CONSTRAINT "checkins_ciclo_de_vida_chk";

ALTER TABLE "checkins"
  ADD CONSTRAINT "checkins_ciclo_de_vida_chk" CHECK (
    ("status" = 'AGUARDANDO'   AND "iniciado_em" IS NULL     AND "finalizado_em" IS NULL)
    OR
    ("status" = 'EM_ATENDIMENTO' AND "iniciado_em" IS NOT NULL AND "finalizado_em" IS NULL)
    OR
    ("status" = 'FINALIZADO' AND "iniciado_em" IS NOT NULL AND "finalizado_em" IS NOT NULL)
    OR
    ("status" = 'CANCELADO' AND "finalizado_em" IS NOT NULL)
  );

-- Nota para quem for ler o codigo depois:
--   Na entidade (CheckIn) isso vive em validar(), e nao em EXIGENCIAS.
--   Os dois CHECKs do banco estao espelhados la para a regra de negocio nao
--   depender de o banco ser a unica validacao. Se mudar este CHECK, mude la
--   tambem, e o teste de conformidade em checkin.spec.ts avisa.