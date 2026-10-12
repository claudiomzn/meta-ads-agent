-- Desfecho do lead pela resposta do vendedor + lembrete de retorno (12/10/2026).
-- Ver `resultado` em WhatsappConversation e o model VendedorPendencia no
-- schema.prisma, e as regras puras em services/whatsapp/resultado.ts.
--
-- ⚠️ Tudo ADITIVO e com IF NOT EXISTS, de propósito: `prisma migrate deploy`
-- roda no boot do Render e migration que falha derruba o bot (ver CLAUDE.md).
-- Nenhum DROP, nenhum ALTER COLUMN TYPE.

ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "resultado" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "resultadoEm" TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "leadNome" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "vendaValorCents" INTEGER;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "vendaSaleId" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "vendaRegistradaEm" TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "motivoPerda" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "motivoPerdaTexto" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "lembretesEnviados" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "ultimoLembreteEm" TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "handoffEm" TIMESTAMP(3);

-- O cron de lembrete varre por (state, label, resultado) de hora em hora.
CREATE INDEX IF NOT EXISTS "WhatsappConversation_state_label_resultado_handoffEm_idx"
  ON "WhatsappConversation"("state", "label", "resultado", "handoffEm");

-- Pergunta "qual deles?" em aberto para um vendedor. Uma por vendedor/negócio.
CREATE TABLE IF NOT EXISTS "VendedorPendencia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL DEFAULT 'default',
    "resposta" JSONB NOT NULL,
    "candidatos" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendedorPendencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VendedorPendencia_userId_businessId_key"
  ON "VendedorPendencia"("userId", "businessId");
