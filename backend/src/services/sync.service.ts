import { PrismaClient } from '@prisma/client';
import { createMetaMCPService } from './meta.mcp.service.js';
import type { DateRange } from '../types/meta.types.js';

const prisma = new PrismaClient();

function todayRange(): DateRange {
  const today = new Date().toISOString().split('T')[0];
  return { since: today, until: today };
}

function last30Days(): DateRange {
  const until = new Date().toISOString().split('T')[0];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { since, until };
}

async function withSyncLog(
  type: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    await prisma.syncLog.create({
      data: { type, status: 'success', duration: Date.now() - start },
    });
  } catch (err) {
    await prisma.syncLog.create({
      data: {
        type,
        status: 'error',
        details: String(err),
        duration: Date.now() - start,
      },
    });
    console.error(`[SyncService] Erro em "${type}":`, err);
  }
}

export class SyncService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // Sincroniza métricas de todas as campanhas publicadas (roda a cada hora)
  async syncPerformanceMetrics(): Promise<void> {
    await withSyncLog('metrics', async () => {
      const campaigns = await prisma.campaign.findMany({
        where: { userId: this.userId, metaCampaignId: { not: null } },
        include: { adSets: { include: { ads: true } } },
      });

      if (!campaigns.length) return;

      const svc = await createMetaMCPService(this.userId);
      const range = last30Days();

      for (const campaign of campaigns) {
        const insights = await svc.getCampaignInsights(campaign.metaCampaignId!, range);

        await prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            metaSpend: insights.spend,
            metaImpressions: insights.impressions,
            metaClicks: insights.clicks,
            metaConversions: insights.conversions,
            metaRoas: insights.roas,
            metaCpc: insights.cpc,
            metaCpl: insights.cpl,
            lastSyncAt: new Date(),
          },
        });

        for (const adSet of campaign.adSets) {
          if (!adSet.metaAdSetId) continue;
          const adSetInsights = await svc.getAdSetInsights(adSet.metaAdSetId, range);
          await prisma.adSet.update({
            where: { id: adSet.id },
            data: {
              metaSpend: adSetInsights.spend,
              metaRoas: adSetInsights.roas,
              metaCpl: adSetInsights.cpl,
              metaFrequency: adSetInsights.frequency,
            },
          });

          for (const ad of adSet.ads) {
            if (!ad.metaAdId) continue;
            const adInsights = await svc.getAdInsights(ad.metaAdId, range);
            await prisma.ad.update({
              where: { id: ad.id },
              data: {
                metaCtr: adInsights.ctr,
                metaCpc: adInsights.cpc,
                metaSpend: adInsights.spend,
              },
            });
          }
        }
      }

      await svc.disconnect();
    });
  }

  // Sincroniza status (ativo/pausado/rejeitado) de cada campanha (roda a cada 15 min)
  async syncCampaignStatuses(): Promise<void> {
    await withSyncLog('status', async () => {
      const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
      if (!conn?.connected || !conn.adAccountIds) return;

      const adAccountIds: string[] = JSON.parse(conn.adAccountIds);
      const svc = await createMetaMCPService(this.userId);

      for (const adAccountId of adAccountIds) {
        const metaCampaigns = await svc.getCampaigns(adAccountId);

        for (const meta of metaCampaigns) {
          await prisma.campaign.updateMany({
            where: { metaCampaignId: meta.id },
            data: { metaStatus: meta.status },
          });
        }
      }

      await svc.disconnect();
    });
  }

  // Importa campanhas criadas diretamente no Gerenciador de Anúncios
  async importExternalCampaigns(adAccountId: string): Promise<void> {
    await withSyncLog('import', async () => {
      const svc = await createMetaMCPService(this.userId);
      const metaCampaigns = await svc.getCampaigns(adAccountId);

      for (const meta of metaCampaigns) {
        const existing = await prisma.campaign.findFirst({
          where: { metaCampaignId: meta.id },
        });

        if (!existing) {
          await prisma.campaign.create({
            data: {
              userId: this.userId,
              name: meta.name,
              product: 'Importado',
              objective: meta.objective,
              budget: meta.dailyBudget ?? 0,
              status: 'imported',
              metaCampaignId: meta.id,
              metaAdAccountId: adAccountId,
              metaStatus: meta.status,
              publishedAt: new Date(meta.createdTime),
              lastSyncAt: new Date(),
            },
          });
        }
      }

      await svc.disconnect();
    });
  }

  // Salva mapeamento entre ID local e ID Meta
  async saveMetaIds(localId: string, metaId: string): Promise<void> {
    await prisma.campaign.update({
      where: { id: localId },
      data: { metaCampaignId: metaId },
    });
  }

  // Processa evento recebido via webhook do Meta
  async handleMetaWebhook(payload: Record<string, unknown>): Promise<void> {
    console.log('[SyncService] Webhook recebido:', JSON.stringify(payload));

    const entry = (payload.entry as Array<{ changes: Array<{ field: string; value: unknown }> }>)?.[0];
    if (!entry) return;

    for (const change of entry.changes ?? []) {
      if (change.field === 'adaccount') {
        // Re-sincroniza status imediatamente quando há mudança na conta
        await this.syncCampaignStatuses();
      }
    }
  }
}
