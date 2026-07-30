-- Fila temporária de onboarding Meta enquanto o OAuth aguarda App Review.
-- Migration incremental: não altera tabelas ou dados das conexões existentes.
CREATE TABLE "MetaConnectionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT,
    "businessPortfolioId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNotes" TEXT,
    "customerMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MetaConnectionRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MetaConnectionRequest_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MetaConnectionRequest_status_check"
      CHECK ("status" IN ('pending', 'configuring', 'needs_adjustment', 'completed', 'cancelled'))
);

CREATE INDEX "MetaConnectionRequest_userId_createdAt_idx"
  ON "MetaConnectionRequest"("userId", "createdAt");

CREATE INDEX "MetaConnectionRequest_status_createdAt_idx"
  ON "MetaConnectionRequest"("status", "createdAt");

-- Um cliente só pode manter uma solicitação aberta por vez. O índice parcial
-- também fecha a corrida entre dois cliques simultâneos no botão de enviar.
CREATE UNIQUE INDEX "MetaConnectionRequest_one_open_per_user_idx"
  ON "MetaConnectionRequest"("userId")
  WHERE "status" IN ('pending', 'configuring', 'needs_adjustment');
