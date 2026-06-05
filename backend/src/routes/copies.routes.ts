import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';

const router = Router();
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

// Score de copy com IA — não salva, só analisa
router.post('/score', async (req: AuthRequest, res: Response) => {
  const { headline, body, cta, objective, product } = req.body as {
    headline?: string; body?: string; cta?: string; objective?: string; product?: string;
  };

  if (!headline || !body || !cta) {
    res.status(400).json({ error: 'headline, body e cta são obrigatórios' });
    return;
  }

  try {
    const result = await ai.scoreCopy({ headline, body, cta, objective, product });
    res.json(result);
  } catch (err) {
    console.error('[score] Erro ao analisar copy:', err);
    // Retorna score neutro em vez de 500 para não quebrar a UI
    res.json({
      score: 0,
      strengths: [],
      issues: ['Não foi possível analisar esta copy agora. Tente novamente.'],
      suggestion: '',
    });
  }
});

// Melhora uma copy baseado nos problemas da análise
router.post('/improve', async (req: AuthRequest, res: Response) => {
  const { headline, body, cta, objective, product, issues, suggestion } = req.body as {
    headline?: string; body?: string; cta?: string;
    objective?: string; product?: string;
    issues?: string[]; suggestion?: string;
  };

  if (!headline || !body || !cta) {
    res.status(400).json({ error: 'headline, body e cta são obrigatórios' });
    return;
  }

  try {
    const result = await ai.improveCopy({
      headline, body, cta, objective, product,
      issues: issues ?? [],
      suggestion: suggestion ?? '',
    });
    res.json(result);
  } catch (err) {
    console.error('[improve] Erro:', err);
    res.status(500).json({ error: 'Não foi possível melhorar a copy agora. Tente novamente.' });
  }
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
