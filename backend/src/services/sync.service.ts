import prisma from '../lib/prisma.js';

import { createMetaMCPService } from './meta.mcp.service.js';
import { sendMail, syncFailureAlertEmail } from './email.service.js';
import type { DateRange } from '../types/meta.types.js';


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
  userId: string,
  type: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    await prisma.syncLog.create({
      data: { userId, type, status: 'success', duration: Date.now() - start },
    });
  } catch (err) {
    const details = String(err);
    await prisma.syncLog.create({
      data: { userId, type, status: 'error', details, duration: Date.now() - start },
    });
    console.error(`[SyncService] Erro em "${type}":`, err);
    await alertOnConsecutiveFailures(userId, type, details);
  }
}

// Notifica o admin quando um tipo de sincronização falha 2x seguidas para o mesmo usuário.
// Dispara apenas na 2ª falha consecutiva (não a cada falha subsequente).
export async function alertOnConsecutiveFailures(userId: string, type: string, details: string): Promise<void> {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const lastLogs = await prisma.syncLog.findMany({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  const lastTwoFailed = lastLogs.length >= 2 && lastLogs[0].status === 'error' && lastLogs[1].status === 'error';
  const isSecondConsecutiveFailure = lastTwoFailed && (lastLogs.length < 3 || lastLogs[2].status !== 'error');
  if (!isSecondConsecutiveFailure) return;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const { html, text } = syncFailureAlertEmail(user?.email ?? userId, type, details);
    await sendMail({
      to: adminEmail,
      subject: `⚠️ Falha de sincronização Meta Ads — ${user?.email ?? userId}`,
      html,
      text,
    });
  } catch (alertErr) {
    console.error('[SyncService] Falha ao enviar alerta de sincronização:', alertErr);
  }
}

export class SyncService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // Sincroniza métricas de todas as campanhas publicadas (roda a cada hora)
  async syncPerformanceMetrics(): Promise<void> {
    await withSyncLog(this.userId, 'metrics', async () => {
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

          // Status real dos anúncios (detecta reprovados: DISAPPROVED / WITH_ISSUES)
          let liveAdStatuses = new Map<string, string>();
          try {
            const liveAds = await svc.getAds(adSet.metaAdSetId);
            liveAdStatuses = new Map(liveAds.map((a) => [a.id, a.status]));
          } catch (err) {
            console.warn('[SyncService] Falha ao buscar status dos anúncios:', err);
          }

          for (const ad of adSet.ads) {
            if (!ad.metaAdId) continue;
            const adInsights = await svc.getAdInsights(ad.metaAdId, range);
            await prisma.ad.update({
              where: { id: ad.id },
              data: {
                metaCtr: adInsights.ctr,
                metaCpc: adInsights.cpc,
                metaSpend: adInsights.spend,
                metaStatus: liveAdStatuses.get(ad.metaAdId) ?? ad.metaStatus,
              },
            });

            // Atualiza métricas reais nas análises de criativos vinculadas a este anúncio
            const creativeAnalyses = await prisma.creativeAnalysis.findMany({
              where: { adId: ad.id },
            });
            if (creativeAnalyses.length > 0) {
              await prisma.creativeAnalysis.updateMany({
                where: { adId: ad.id },
                data: {
                  realCtr: adInsights.ctr ?? undefined,
                  realCpl: adInsights.cpl ?? undefined,
                  realRoas: undefined, // anúncio individual não tem ROAS direto
                  realImpressions: adInsights.impressions ?? undefined,
                },
              });
            }
          }
        }
      }

      await svc.disconnect();

      // ── Snapshot diário ──────────────────────────────────────────────────
      // Agrega totais de todas as campanhas e salva/atualiza o registro de hoje.
      await this.saveDailySnapshot();
    });
  }

  // Grava (ou atualiza) o snapshot do dia com os totais atuais das campanhas
  async saveDailySnapshot(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const campaigns = await prisma.campaign.findMany({
      where: { userId: this.userId, metaSpend: { not: null } },
      select: {
        metaSpend: true,
        metaImpressions: true,
        metaClicks: true,
        metaConversions: true,
        metaStatus: true,
      },
    });

    if (!campaigns.length) return;

    const totals = campaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + (c.metaSpend ?? 0),
        impressions: acc.impressions + (c.metaImpressions ?? 0),
        clicks: acc.clicks + (c.metaClicks ?? 0),
        conversions: acc.conversions + (c.metaConversions ?? 0),
        activeCampaigns: acc.activeCampaigns + (c.metaStatus === 'ACTIVE' ? 1 : 0),
      }),
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, activeCampaigns: 0 },
    );

    await prisma.dailyMetric.upsert({
      where: { userId_date: { userId: this.userId, date: today } },
      update: totals,
      create: { userId: this.userId, date: today, ...totals },
    });
  }

  // Sincroniza status (ativo/pausado/rejeitado) de cada campanha (roda a cada 15 min)
  async syncCampaignStatuses(): Promise<void> {
    await withSyncLog(this.userId, 'status', async () => {
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
    await withSyncLog(this.userId, 'import', async () => {
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
