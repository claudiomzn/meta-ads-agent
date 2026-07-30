-- Verificação automática do acesso de parceiro e saúde da conexão.
ALTER TABLE "MetaConnectionRequest"
  ADD COLUMN "partnerAccessVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastVerificationAt" TIMESTAMP(3),
  ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MCPConnection"
  ADD COLUMN "connectionHealth" TEXT NOT NULL DEFAULT 'healthy',
  ADD COLUMN "connectionIssue" TEXT,
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);

ALTER TABLE "MCPConnection"
  ADD CONSTRAINT "MCPConnection_health_check"
  CHECK ("connectionHealth" IN ('healthy', 'degraded', 'revoked'));
