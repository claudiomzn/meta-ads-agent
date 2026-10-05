-- Verificação automática do acesso de parceiro e saúde da conexão.
-- IF NOT EXISTS / guarda de constraint: esta migration não constava em produção
-- (criada por db push), então o primeiro `migrate deploy` a aplica em cima do
-- que já existe — tem de ser no-op.
ALTER TABLE "MetaConnectionRequest"
  ADD COLUMN IF NOT EXISTS "partnerAccessVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastVerificationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MCPConnection"
  ADD COLUMN IF NOT EXISTS "connectionHealth" TEXT NOT NULL DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS "connectionIssue" TEXT,
  ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3);

-- ADD CONSTRAINT não aceita IF NOT EXISTS: guarda contra "já existe".
DO $$ BEGIN
  ALTER TABLE "MCPConnection"
    ADD CONSTRAINT "MCPConnection_health_check"
    CHECK ("connectionHealth" IN ('healthy', 'degraded', 'revoked'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
