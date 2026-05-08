-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "budget" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metaCampaignId" TEXT,
    "metaAdAccountId" TEXT,
    "metaStatus" TEXT,
    "publishedAt" DATETIME,
    "lastSyncAt" DATETIME,
    "metaSpend" REAL,
    "metaImpressions" INTEGER,
    "metaClicks" INTEGER,
    "metaConversions" INTEGER,
    "metaRoas" REAL,
    "metaCpc" REAL,
    "metaCpl" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dailyBudget" REAL NOT NULL,
    "targeting" TEXT NOT NULL,
    "optimizationGoal" TEXT NOT NULL,
    "metaAdSetId" TEXT,
    "metaStatus" TEXT,
    "metaSpend" REAL,
    "metaRoas" REAL,
    "metaCpl" REAL,
    "metaFrequency" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "metaAdId" TEXT,
    "metaStatus" TEXT,
    "metaCreativeId" TEXT,
    "metaCtr" REAL,
    "metaCpc" REAL,
    "metaSpend" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ad_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "AdSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCPConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "metaAccessToken" TEXT NOT NULL,
    "adAccountIds" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastConnectedAt" DATETIME,
    "expiresAt" DATETIME,
    "mcpUrl" TEXT,
    "mcpProvider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MCPConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "duration" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" TEXT,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "window" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "alertEmail" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastChecked" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RuleLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metrics" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Copy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "score" INTEGER,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Copy_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Audience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "behaviors" TEXT,
    "ageMin" INTEGER NOT NULL,
    "ageMax" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "locations" TEXT NOT NULL,
    "estimatedSize" INTEGER,
    "metaAudienceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Audience_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreativeBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "midjourneyPrompt" TEXT,
    "palette" TEXT NOT NULL,
    "dimensions" TEXT NOT NULL,
    "elements" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreativeBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variable" TEXT NOT NULL,
    "variantA" TEXT NOT NULL,
    "variantB" TEXT NOT NULL,
    "budget" REAL NOT NULL,
    "duration" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "winner" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ABTest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_metaCampaignId_key" ON "Campaign"("metaCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AdSet_metaAdSetId_key" ON "AdSet"("metaAdSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_metaAdId_key" ON "Ad"("metaAdId");

-- CreateIndex
CREATE UNIQUE INDEX "MCPConnection_userId_key" ON "MCPConnection"("userId");
