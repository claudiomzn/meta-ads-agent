import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const ABTestSchema = z.object({
  name: z.string().min(1),
  hypothesis: z.string().optional().default(''),
  variable: z.string().min(1),
  variantA: z.string().min(1),
  variantB: z.string().min(1),
  budget: z.number().positive(),
  duration: z.number().int().positive(),
  metric: z.string().min(1),
  campaignId: z.string().optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const tests = await prisma.aBTest.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(tests);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = ABTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const test = await prisma.aBTest.create({
    data: { ...parsed.data, userId: req.userId!, status: 'running' },
  });

  res.status(201).json(test);
});

router.patch('/:id/winner', async (req: AuthRequest, res: Response) => {
  const { winner } = req.body;
  if (!['A', 'B'].includes(winner)) {
    res.status(400).json({ error: 'winner deve ser A ou B' });
    return;
  }

  const existing = await prisma.aBTest.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Teste não encontrado' });
    return;
  }

  const updated = await prisma.aBTest.update({
    where: { id: req.params.id },
    data: { winner, status: 'completed' },
  });

  res.json(updated);
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.aBTest.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Teste não encontrado' });
    return;
  }

  await prisma.aBTest.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
