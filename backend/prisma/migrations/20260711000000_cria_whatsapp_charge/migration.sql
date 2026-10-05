-- Cria a tabela WhatsappCharge que FALTAVA nas migrations.
--
-- Por que isto existe: a WhatsappCharge nasceu por `db push` (drift), nunca teve
-- um CREATE TABLE. A migration 20260711120000_whatsapp_multi_business ALTERa a
-- WhatsappCharge — então, num banco construído só pelas migrations, ela quebrava
-- ("relation WhatsappCharge does not exist"). Esta migration vem ANTES da
-- multi_business e cria a tabela na forma PRÉ-multi_business (com `pendingUserId`
-- e os índices antigos), que a multi_business depois transforma em businessId +
-- pendingKey. Assim a cadeia reconstrói um banco do zero.
--
-- No-op em produção: a tabela já existe (via db push) na forma ATUAL, então o
-- CREATE TABLE IF NOT EXISTS é ignorado e o índice do pendingUserId só é criado
-- se a coluna existir (não existe em produção, foi dropada pela multi_business).
-- 2026-10-05.

CREATE TABLE IF NOT EXISTS "WhatsappCharge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "messagesGranted" INTEGER NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "invoiceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappCharge_asaasPaymentId_key" ON "WhatsappCharge"("asaasPaymentId");

-- Índices da forma pré-multi_business. Guardados pela existência da coluna
-- `pendingUserId`: num banco novo ela existe (acabou de ser criada acima) e os
-- índices nascem; num banco que já passou pela multi_business (produção) ela
-- não existe e este bloco não faz nada.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'WhatsappCharge' AND column_name = 'pendingUserId') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappCharge_pendingUserId_key" ON "WhatsappCharge"("pendingUserId");
    CREATE INDEX IF NOT EXISTS "WhatsappCharge_userId_status_idx" ON "WhatsappCharge"("userId", "status");
  END IF;
END $$;
