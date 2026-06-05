import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/chart?days=30
// Retorna métricas diárias dos últimos N dias para o gráfico do Dashboard.
// Dias sem dados aparecem como zeros (não há buracos no gráfico).
router.get('/chart', async (req: AuthRequest, res: Response) => {
  const days = Math.min(Number(req.query.days ?? 30), 90);

  // Gera a lista de datas do intervalo (mais antigo → mais recente)
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const since = dates[0];
  const until = dates[dates.length - 1];

  const records = await prisma.dailyMetric.findMany({
    where: {
      userId: req.userId!,
      date: { gte: since, lte: until },
    },
    orderBy: { date: 'asc' },
  });

  // Índice para lookup O(1)
  const byDate = new Map(records.map((r) => [r.date, r]));

  const data = dates.map((date) => {
    const r = byDate.get(date);
    return {
      date,
      label: new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      spend: r?.spend ?? 0,
      impressions: r?.impressions ?? 0,
      clicks: r?.clicks ?? 0,
      conversions: r?.conversions ?? 0,
      activeCampaigns: r?.activeCampaigns ?? 0,
    };
  });

  res.json(data);
});

// GET /api/dashboard/summary
// Totais consolidados (soma de todas as campanhas com métricas)
router.get('/summary', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.userId!, metaSpend: { not: null } },
    select: {
      metaSpend: true,
      metaImpressions: true,
      metaClicks: true,
      metaConversions: true,
      metaRoas: true,
      metaCpc: true,
      metaCpl: true,
      metaStatus: true,
    },
  });

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

  const withRoas = campaigns.filter((c) => (c.metaRoas ?? 0) > 0);
  const avgRoas = withRoas.length
    ? withRoas.reduce((s, c) => s + (c.metaRoas ?? 0), 0) / withRoas.length
    : null;

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;

  // Data do último sync bem-sucedido
  const lastSync = await prisma.syncLog.findFirst({
    where: { userId: req.userId!, status: 'success' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  res.json({ ...totals, avgRoas, ctr, lastSyncAt: lastSync?.createdAt ?? null });
});

export default router;
