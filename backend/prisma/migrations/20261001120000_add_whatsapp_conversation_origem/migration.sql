-- Origem de cada conversa do bot de WhatsApp (01/10/2026).
--
-- Por que existe: a conversa não guardava nada sobre de onde o lead veio. Não
-- dava para saber se um QUENTE veio do Google, da Meta ou do orgânico, nem de
-- qual página ou anúncio. E o click id do anúncio "clique para o WhatsApp"
-- (ctwaClid), que a Meta manda só na 1ª mensagem, se perdia antes do Lead
-- QUENTE ser enviado à CAPI — mensagens depois.
--
-- ⚠️ TODO comando aqui é `IF NOT EXISTS` de propósito: o schema tem drift
-- (campos aplicados com `db push`, fora do histórico) e o Render roda
-- `prisma migrate deploy` antes de subir. Migration não idempotente derruba o
-- deploy. Colunas aditivas e anuláveis: sem backfill, sem downtime — conversa
-- antiga fica com origem desconhecida (NULL), que é a verdade.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "origemCanal" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "origemRef" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "ctwaClid" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "origemAnuncioId" TEXT;
