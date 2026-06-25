-- CreateTable
CREATE TABLE "WhatsappConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessName" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "differentials" TEXT,
    "region" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'amigável e profissional',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "qualifiedCriteria" TEXT NOT NULL DEFAULT 'Respondeu às perguntas de qualificação',
    "maxQuestions" INTEGER NOT NULL DEFAULT 4,
    "maxBotMessages" INTEGER NOT NULL DEFAULT 8,
    "handoffContact" TEXT,
    "businessHours" TEXT,
    "transport" TEXT NOT NULL DEFAULT 'none',
    "transportConfig" JSONB NOT NULL DEFAULT '{}',
    "conversionId" TEXT,
    "conversionLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadPhone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'greeting',
    "label" TEXT,
    "questionsAsked" INTEGER NOT NULL DEFAULT 0,
    "botMessages" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "conversionFired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConfig_userId_key" ON "WhatsappConfig"("userId");

-- CreateIndex
CREATE INDEX "WhatsappConversation_userId_state_idx" ON "WhatsappConversation"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConversation_userId_leadPhone_key" ON "WhatsappConversation"("userId", "leadPhone");
