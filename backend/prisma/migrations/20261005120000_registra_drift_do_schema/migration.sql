-- Registra o DRIFT: colunas e a tabela StudioCreative que existem no
-- schema.prisma (e em produção, criadas por `db push`) mas que nenhuma migration
-- criava. Com isto, um banco construído só pelas migrations passa a bater com o
-- schema (o `migrate diff --from-migrations` dá "No difference detected").
--
-- 100% idempotente (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS):
-- em produção tudo já existe, então é no-op; num banco novo, cria. Sem DROP,
-- sem ALTER COLUMN. 2026-10-05.

-- User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creativeGenerationsMonth" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creativeGenerationsUsed" INTEGER NOT NULL DEFAULT 0;

-- WhatsappConfig
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "billingCpfCnpj" TEXT;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "dailyFreeConversations" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "dailyOverageCentsPerMsg" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "prepaidMessagesRemaining" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "rechargeAmountCents" INTEGER NOT NULL DEFAULT 2000;

-- WhatsappConversation
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "billable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "capiLeadFired" BOOLEAN NOT NULL DEFAULT false;

-- StudioCreative: tabela inteira, nascida por db push
CREATE TABLE IF NOT EXISTS "StudioCreative" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "visualConcept" TEXT,
    "imagePrompt" TEXT,
    "imageUrl" TEXT,
    "aspect" TEXT NOT NULL DEFAULT '1:1',
    "product" TEXT,
    "niche" TEXT,
    "objective" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioCreative_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StudioCreative_userId_idx" ON "StudioCreative"("userId");
