-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "estimatedSavings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProposal_userId_status_idx" ON "AgentProposal"("userId", "status");
