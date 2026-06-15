import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { buildTargeting, type AdPlatform } from '../services/targeting.service.js';

const router = Router();
const ai = new AIService();

router.use(authMiddleware);

// Gera plano de campanha via IA (sem salvar)
router.post('/generate-plan', async (req: AuthRequest, res: Response) => {
  const { product, objective, budget, audience, differentials, ticketMedio, regiao, concorrentes, niche, businessName } = req.body;
  if (!product || !objective || !budget) {
    res.status(400).json({ error: 'product, objective e budget são obrigatórios' });
    return;
  }
  const plan = await ai.generateCampaignPlan({
    product, objective, budget, audience, differentials,
    ticketMedio, regiao, concorrentes, niche, businessName,
  });
  res.json(plan);
});

// Monta o público-alvo automaticamente a partir do briefing (idade, gênero,
// localização e interesses reais do Meta). Usado pelo Estúdio de Criativos
// antes de criar a campanha.
router.post('/build-targeting', async (req: AuthRequest, res: Response) => {
  const { product, audience, niche, objective, businessName, regiao, platform } = req.body as {
    product?: string; audience?: string; niche?: string; objective?: string;
    businessName?: string; regiao?: string; platform?: AdPlatform;
  };

  if (!product?.trim()) {
    res.status(400).json({ error: 'product é obrigatório' });
    return;
  }

  try {
    const result = await buildTargeting(
      req.userId!,
      { product, audience, niche, objective, businessName, regiao },
      platform ?? 'ambos',
    );
    res.json(result);
  } catch (err) {
    console.error('[campaigns] Falha ao montar targeting:', err);
    const reason = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Não foi possível montar o público-alvo automaticamente: ${reason}` });
  }
});

const AdSchema = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  bodyText: z.string().min(1),
  cta: z.string().min(1),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  destinationUrl: z.string().optional(),
});

const AdSetSchema = z.object({
  name: z.string().min(1),
  dailyBudget: z.number().positive(),
  targeting: z.record(z.unknown()).default({}),
  optimizationGoal: z.string().min(1),
  billingEvent: z.string().default('IMPRESSIONS'),
  audienceId: z.string().optional(),
  ads: z.array(AdSchema).default([]),
});

const CampaignSchema = z.object({
  name: z.string().min(1),
  product: z.string().min(1),
  objective: z.string().min(1),
  budget: z.number().positive(),
  adSets: z.array(AdSetSchema).optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.userId! },
    include: { adSets: { include: { ads: true } }, copies: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(campaigns);
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      adSets: { include: { ads: true, audience: true } },
      copies: true,
      audiences: true,
      briefs: true,
      abTests: true,
    },
  });

  if (!campaign) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  res.json(campaign);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { adSets, ...campaignData } = parsed.data;

  const campaign = await prisma.campaign.create({
    data: {
      ...campaignData,
      userId: req.userId!,
      adSets: adSets?.length
        ? {
            create: adSets.map((as) => ({
              name: as.name,
              dailyBudget: as.dailyBudget,
              targeting: JSON.stringify(as.targeting),
              optimizationGoal: as.optimizationGoal,
              audienceId: as.audienceId ?? undefined,
              ads: {
                create: as.ads.map((ad) => ({
                  name: ad.name,
                  headline: ad.headline,
                  bodyText: ad.bodyText,
                  cta: ad.cta,
                  imageUrl: ad.imageUrl,
                  videoUrl: ad.videoUrl,
                  destinationUrl: ad.destinationUrl,
                })),
              },
            })),
          }
        : undefined,
    },
    include: { adSets: { include: { ads: true, audience: true } } },
  });

  res.status(201).json(campaign);
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { adSets: { include: { ads: true, audience: true } } },
  });
  if (!existing) { res.status(404).json({ error: 'Campanha não encontrada' }); return; }

  const parsed = CampaignSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { adSets, ...campaignData } = parsed.data;

  const updated = await prisma.campaign.update({
    where: { id: req.params.id },
    data: {
      ...campaignData,
      // Se vieram adSets, apaga os existentes e recria
      ...(adSets
        ? {
            adSets: {
              deleteMany: {},
              create: adSets.map((as) => ({
                name: as.name,
                dailyBudget: as.dailyBudget,
                targeting: typeof as.targeting === 'string' ? as.targeting : JSON.stringify(as.targeting ?? {}),
                optimizationGoal: as.optimizationGoal,
                audienceId: as.audienceId ?? undefined,
                ads: {
                  create: as.ads.map((ad) => ({
                    name: ad.name,
                    headline: ad.headline,
                    bodyText: ad.bodyText,
                    cta: ad.cta,
                    imageUrl: ad.imageUrl,
                    videoUrl: ad.videoUrl,
                    destinationUrl: ad.destinationUrl,
                  })),
                },
              })),
            },
          }
        : {}),
    },
    include: { adSets: { include: { ads: true, audience: true } } },
  });

  res.json(updated);
});

// ─── Duplicar campanha ────────────────────────────────────────────────────────

router.post('/:id/duplicate', async (req: AuthRequest, res: Response) => {
  const original = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { adSets: { include: { ads: true, audience: true } } },
  });

  if (!original) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  // Remove IDs gerados e campos Meta (a cópia é um rascunho limpo)
  const {
    id, createdAt, updatedAt,
    metaCampaignId, metaAdAccountId, metaStatus, publishedAt, lastSyncAt,
    metaSpend, metaImpressions, metaClicks, metaConversions, metaRoas, metaCpc, metaCpl,
    adSets,
    ...campaignData
  } = original;

  const duplicate = await prisma.campaign.create({
    data: {
      ...campaignData,
      name: `${original.name} (cópia)`,
      status: 'draft',
      adSets: {
        create: adSets.map((as) => ({
          name: as.name,
          dailyBudget: as.dailyBudget,
          targeting: as.targeting,
          optimizationGoal: as.optimizationGoal,
          ads: {
            create: as.ads.map((ad) => ({
              name: ad.name,
              headline: ad.headline,
              bodyText: ad.bodyText,
              cta: ad.cta,
              imageUrl: ad.imageUrl,
              videoUrl: ad.videoUrl,
              destinationUrl: ad.destinationUrl,
            })),
          },
        })),
      },
    },
    include: { adSets: { include: { ads: true, audience: true } } },
  });

  res.status(201).json(duplicate);
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  await prisma.campaign.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ─── Prévia de anúncio ────────────────────────────────────────────────────────
// Retorna os dados necessários para renderizar o AdPreviewModal
router.get('/ads/:adId/preview-data', async (req: AuthRequest, res: Response) => {
  const ad = await prisma.ad.findFirst({
    where: { id: req.params.adId },
    include: {
      adSet: {
        include: { campaign: true },
      },
    },
  });

  if (!ad) {
    res.status(404).json({ error: 'Anúncio não encontrado' });
    return;
  }

  // Garante que o anúncio pertence ao usuário autenticado
  if (ad.adSet.campaign.userId !== req.userId) {
    res.status(403).json({ error: 'Acesso negado' });
    return;
  }

  // Busca o nome do usuário para usar como pageName
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });

  res.json({
    headline:       ad.headline,
    bodyText:       ad.bodyText,
    cta:            ad.cta,
    destinationUrl: ad.destinationUrl ?? '',
    imageUrl:       ad.imageUrl ?? undefined,
    videoUrl:       ad.videoUrl ?? undefined,
    pageName:       user?.name ?? 'Sua Empresa',
    pageAvatarUrl:  undefined,
  });
});

export default router;
