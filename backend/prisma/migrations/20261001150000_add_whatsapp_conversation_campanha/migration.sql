-- Campanha que trouxe cada conversa do bot (01/10/2026).
--
-- Complementa 20261001120000 (origem): página + canal não dizem QUAL campanha
-- trouxe o lead, e sem isso o app não conta leads e QUENTES por campanha.
--
-- ⚠️ IF NOT EXISTS de propósito — drift do schema + `prisma migrate deploy` no
-- Render (ver CLAUDE.md). Coluna aditiva e anulável: conversa antiga fica com
-- campanha desconhecida (NULL), que é a verdade.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "origemCampanhaId" TEXT;
