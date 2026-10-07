-- Clique em anúncio registrado pelo site, para o lead QUENTE subir ao Google
-- com o gclid (07/10/2026). Ver model CliqueDoSite no schema.prisma.
--
-- ⚠️ IF NOT EXISTS de propósito — `prisma migrate deploy` roda no boot do
-- Render e migration que falha derruba o bot (ver CLAUDE.md). Tudo aditivo.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "origemClique" TEXT;

CREATE TABLE IF NOT EXISTS "CliqueDoSite" (
    "codigo" TEXT NOT NULL,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "site" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CliqueDoSite_pkey" PRIMARY KEY ("codigo")
);

CREATE INDEX IF NOT EXISTS "CliqueDoSite_createdAt_idx" ON "CliqueDoSite"("createdAt");
