import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';

const router = Router();
const ai = new AIService();

router.use(authMiddleware);

const AudienceSchema = z.object({
  name: z.string().min(1),
  interests: z.string().min(1),
  behaviors: z.string().optional().default(''),
  ageMin: z.number().int().min(18).max(65),
  ageMax: z.number().int().min(18).max(65),
  gender: z.enum(['all', 'male', 'female']),
  locations: z.string().min(1),
  campaignId: z.string().optional(),
  estimatedSize: z.number().optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const audiences = await prisma.audience.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    include: {
      adSets: {
        select: { id: true, name: true, campaign: { select: { name: true } } },
      },
    },
  });
  res.json(audiences);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = AudienceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const audience = await prisma.audience.create({
    data: { ...parsed.data, userId: req.userId! },
  });

  res.status(201).json(audience);
});

// Sugestão de interesses via IA
router.post('/suggest', async (req: AuthRequest, res: Response) => {
  const { product } = req.body;
  if (!product) {
    res.status(400).json({ error: 'product é obrigatório' });
    return;
  }

  try {
    // Gera plano para extrair interesses de targeting sugeridos pela IA
    const plan = await ai.generateCampaignPlan({
      product,
      objective: 'LEAD_GENERATION',
      budget: 1000,
      audience: 'público geral',
    }) as { adSets?: Array<{ targeting?: { interests?: Array<{ name: string }> } }> };

    const rawInterests = plan.adSets?.[0]?.targeting?.interests ?? [];
    const interestNames = rawInterests.map((i) => i.name).filter(Boolean).join(', ');

    res.json({
      interests: interestNames || 'Marketing digital, Empreendedorismo, Negócios',
      behaviors: 'Compradores online, Usuários de dispositivos móveis',
    });
  } catch {
    res.json({
      interests: 'Marketing digital, Empreendedorismo, Negócios',
      behaviors: 'Compradores online',
    });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.audience.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Público não encontrado' });
    return;
  }

  await prisma.audience.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
