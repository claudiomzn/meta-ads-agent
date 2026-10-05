-- IF NOT EXISTS: migration não registrada em produção (db push); o primeiro
-- `migrate deploy` a aplica sobre o que já existe — no-op.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "metaPageId" TEXT;
