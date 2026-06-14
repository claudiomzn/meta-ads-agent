import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { generateImages, isImageGenEnabled, type CreativeAspect } from '../services/image.service.js';
import { rehostImage } from '../services/storage.service.js';

const router = Router();
const ai = new AIService();

router.use(authMiddleware);

// Informa ao frontend se a geração de arte real está ativa (FAL_KEY configurada)
router.get('/status', (_req: AuthRequest, res: Response) => {
  res.json({ imageGenEnabled: isImageGenEnabled() });
});

// Gera um conjunto de criativos (copy + conceito + arte) a partir do briefing
router.post('/generate', async (req: AuthRequest, res: Response) => {
  const {
    product, audience, objective, differentials, tone, niche, businessName,
    count, aspect,
  } = req.body as {
    product?: string; audience?: string; objective?: string; differentials?: string;
    tone?: string; niche?: string; businessName?: string;
    count?: number; aspect?: CreativeAspect;
  };

  if (!product?.trim()) {
    res.status(400).json({ error: 'product é obrigatório' });
    return;
  }

  // 1. Copies + conceitos + prompts de imagem (uma única chamada à IA)
  const { variations } = await ai.generateCreativeSet({
    product, audience, objective, differentials, tone, niche, businessName, count,
  });

  if (variations.length === 0) {
    res.status(502).json({ error: 'A IA não retornou variações. Tente novamente.' });
    return;
  }

  // 2. Arte real (em paralelo) — só roda se FAL_KEY estiver configurada
  const aspectRatio: CreativeAspect = aspect ?? '1:1';
  const imageUrls = isImageGenEnabled()
    ? await generateImages(variations.map((v) => v.imagePrompt), aspectRatio)
    : variations.map(() => null);

  const creatives = variations.map((v, i) => ({
    id: `cr_${Date.now()}_${i}`,
    framework: v.framework,
    headline: v.headline,
    body: v.body,
    cta: v.cta,
    visualConcept: v.visualConcept,
    imagePrompt: v.imagePrompt,
    imageUrl: imageUrls[i],
    aspect: aspectRatio,
  }));

  res.json({ creatives, imageGenEnabled: isImageGenEnabled() });
});

// ─── Arquivo: salvar / listar / excluir criativos ──────────────────────────────

// Salva um criativo no arquivo do usuário. Re-hospeda a imagem no Supabase
// Storage (URL durável) antes de persistir, já que o link do fal expira.
router.post('/save', async (req: AuthRequest, res: Response) => {
  const c = req.body as {
    framework?: string; headline?: string; body?: string; cta?: string;
    visualConcept?: string; imagePrompt?: string; imageUrl?: string | null;
    aspect?: string; product?: string; niche?: string; objective?: string;
  };

  if (!c.headline || !c.body || !c.cta) {
    res.status(400).json({ error: 'headline, body e cta são obrigatórios' });
    return;
  }

  const durableUrl = c.imageUrl ? await rehostImage(c.imageUrl, req.userId!) : null;

  const saved = await prisma.studioCreative.create({
    data: {
      userId: req.userId!,
      framework: c.framework ?? 'AIDA',
      headline: c.headline,
      body: c.body,
      cta: c.cta,
      visualConcept: c.visualConcept,
      imagePrompt: c.imagePrompt,
      imageUrl: durableUrl,
      aspect: c.aspect ?? '1:1',
      product: c.product,
      niche: c.niche,
      objective: c.objective,
      favorite: true,
    },
  });

  res.status(201).json(saved);
});

router.get('/creatives', async (req: AuthRequest, res: Response) => {
  const creatives = await prisma.studioCreative.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(creatives);
});

router.delete('/creatives/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.studioCreative.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Criativo não encontrado' });
    return;
  }
  await prisma.studioCreative.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
