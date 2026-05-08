import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';

const router = Router();
const prisma = new PrismaClient();
const ai = new AIService();

router.use(authMiddleware);

// Gera plano de campanha via IA (sem salvar)
router.post('/generate-plan', async (req: AuthRequest, res: Response) => {
  const { product, objective, budget, audience, differentials } = req.body;
  if (!product || !objective || !budget) {
    res.status(400).json({ error: 'product, objective e budget são obrigatórios' });
    return;
  }
  const plan = await ai.generateCampaignPlan({ product, objective, budget, audience, differentials });
  res.json(plan);
});

const AdSchema = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  bodyText: z.string().min(1),
  cta: z.string().min(1),
  imageUrl: z.string().optional(),
  destinationUrl: z.string().optional(),
});

const AdSetSchema = z.object({
  name: z.string().min(1),
  dailyBudget: z.number().positive(),
  targeting: z.record(z.unknown()).default({}),
  optimizationGoal: z.string().min(1),
  billingEvent: z.string().default('IMPRESSIONS'),
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
      adSets: { include: { ads: true } },
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
              ads: {
                create: as.ads.map((ad) => ({
                  name: ad.name,
                  headline: ad.headline,
                  bodyText: ad.bodyText,
                  cta: ad.cta,
                  imageUrl: ad.imageUrl,
                })),
              },
            })),
          }
        : undefined,
    },
    include: { adSets: { include: { ads: true } } },
  });

  res.status(201).json(campaign);
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  const UpdateSchema = CampaignSchema.omit({ adSets: true }).partial();
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.campaign.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  res.json(updated);
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

export default router;
