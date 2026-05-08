import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';

const router = Router();
const prisma = new PrismaClient();
const ai = new AIService();

router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  const copies = await prisma.copy.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(copies);
});

router.post('/generate', async (req: AuthRequest, res: Response) => {
  const { campaignId, product, audience, framework, format, tone } = req.body;

  if (!product || !framework || !format) {
    res.status(400).json({ error: 'product, framework e format são obrigatórios' });
    return;
  }

  const generated = await ai.generateCopy({ product, audience, framework, format, tone });

  const copy = await prisma.copy.create({
    data: {
      userId: req.userId!,
      campaignId: campaignId ?? null,
      format,
      framework,
      headline: generated.headline,
      body: generated.body,
      cta: generated.cta,
    },
  });

  res.status(201).json(copy);
});

router.patch('/:id/favorite', async (req: AuthRequest, res: Response) => {
  const copy = await prisma.copy.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!copy) {
    res.status(404).json({ error: 'Copy não encontrado' });
    return;
  }

  const updated = await prisma.copy.update({
    where: { id: req.params.id },
    data: { favorite: !copy.favorite },
  });

  res.json(updated);
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const copy = await prisma.copy.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!copy) {
    res.status(404).json({ error: 'Copy não encontrado' });
    return;
  }

  await prisma.copy.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
