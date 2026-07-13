-- WhatsApp multi-negócio (Fase 1 — backend): uma conta pode ter vários
-- "negócios" (cada um com sua persona, seu número/instância Evolution, suas
-- conversas e sua própria cobrança pré-paga). Zero downtime, 100% retrocompatível:
--   • businessId é sentinela NOT NULL "default" (não NULL) porque o Postgres
--     trata NULLs como distintos em índices únicos — @@unique([userId, businessId])
--     não bloquearia duas linhas (userId, NULL). Com "default" fixo a
--     unicidade é garantida de verdade pelo próprio banco.
--   • ADD COLUMN ... NOT NULL DEFAULT 'default' backfila as linhas existentes
--     automaticamente (Postgres aplica o default aos registros já gravados,
--     sem reescrever a tabela) — nenhum UPDATE em massa é necessário.
--   • Contas com config/conversas/cobranças de hoje (todas ficam com
--     businessId='default') continuam funcionando sem nenhuma ação do cliente.

-- ── WhatsappConfig: 1 config por (userId, businessId) em vez de 1 por userId ──
ALTER TABLE "WhatsappConfig" ADD COLUMN "businessId" TEXT NOT NULL DEFAULT 'default';

-- Palavra-gatilho opcional por negócio: quando definida, conversa NOVA só é
-- criada/respondida se a 1ª mensagem contiver o termo (sem caixa/acentos).
-- NULL (default) = comportamento atual, responde a todos.
ALTER TABLE "WhatsappConfig" ADD COLUMN "triggerKeyword" TEXT;

DROP INDEX "WhatsappConfig_userId_key";
CREATE UNIQUE INDEX "WhatsappConfig_userId_businessId_key" ON "WhatsappConfig"("userId", "businessId");

-- ── WhatsappConversation: o mesmo lead pode falar com dois negócios da mesma
--    conta — passam a ser conversas independentes (userId, businessId, leadPhone) ──
ALTER TABLE "WhatsappConversation" ADD COLUMN "businessId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "WhatsappConversation_userId_leadPhone_key";
CREATE UNIQUE INDEX "WhatsappConversation_userId_businessId_leadPhone_key" ON "WhatsappConversation"("userId", "businessId", "leadPhone");

DROP INDEX "WhatsappConversation_userId_state_idx";
CREATE INDEX "WhatsappConversation_userId_businessId_state_idx" ON "WhatsappConversation"("userId", "businessId", "state");

-- ── WhatsappCharge: garantia de "no máximo 1 PENDING" passa a ser por
--    usuário+negócio. pendingUserId (String? @unique = userId) vira
--    pendingKey (String? @unique = "${userId}:${businessId}"), preservando
--    EXATAMENTE a mesma semântica do índice único parcial (reclama o slot
--    antes de chamar o Asaas, libera no catch, limpa ao marcar PAID) — só que
--    agora escopado por negócio. Backfill: qualquer cobrança PENDING em voo
--    no momento do deploy (pendingUserId preenchido) ganha o pendingKey
--    equivalente do negócio "default", sem perder a proteção contra corrida
--    durante a janela do deploy. ──
ALTER TABLE "WhatsappCharge" ADD COLUMN "businessId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "WhatsappCharge" ADD COLUMN "pendingKey" TEXT;

UPDATE "WhatsappCharge"
SET "pendingKey" = "pendingUserId" || ':default'
WHERE "pendingUserId" IS NOT NULL;

DROP INDEX "WhatsappCharge_pendingUserId_key";
ALTER TABLE "WhatsappCharge" DROP COLUMN "pendingUserId";
CREATE UNIQUE INDEX "WhatsappCharge_pendingKey_key" ON "WhatsappCharge"("pendingKey");

DROP INDEX "WhatsappCharge_userId_status_idx";
CREATE INDEX "WhatsappCharge_userId_businessId_status_idx" ON "WhatsappCharge"("userId", "businessId", "status");
