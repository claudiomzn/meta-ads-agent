-- Cooldown das automações: colunas introduzidas no commit c0039e0 (28/07/2026).
--
-- Estas colunas JÁ EXISTEM em produção: o `startCommand` do Render rodava
-- `prisma db push --accept-data-loss` a cada start do serviço, então o schema
-- foi aplicado no banco sem nunca passar por uma migration. Este arquivo apenas
-- registra a mudança no histórico, para que `prisma migrate deploy` pare de
-- divergir do banco real.
--
-- Em produção esta migration é marcada como aplicada (`migrate resolve
-- --applied`) e nunca executada. O `IF NOT EXISTS` existe para o caso de ela
-- rodar de fato num banco de desenvolvimento novo — ou de ser executada por
-- engano num banco que já tem as colunas.
ALTER TABLE "AutomationRule" ADD COLUMN IF NOT EXISTS "lastTriggeredAt" TIMESTAMP(3);
ALTER TABLE "AutomationRule" ADD COLUMN IF NOT EXISTS "triggerCount" INTEGER NOT NULL DEFAULT 0;
