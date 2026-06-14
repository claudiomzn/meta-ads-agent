import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { generateImages, isImageGenEnabled, type CreativeAspect } from '../services/image.service.js';
import { rehostImage } from '../services/storage.service.js';
import { getUserPlan, isPaidPlan } from '../services/plan.service.js';

const router = Router();
const ai = new AIService();

// Quantas gerações completas (arte + copy) o plano de teste libera no total.
// Acima desse limite, o trial continua tendo acesso só a copy + conceito (sem arte).
const TRIAL_GENERATION_LIMIT = Number(process.env.CREATIVE_STUDIO_TRIAL_LIMIT ?? 1);

router.use(authMiddleware);

// Informa ao frontend se a geração de arte real está ativa (FAL_KEY configurada
// e, no caso de usuários em trial, se ainda há gerações com arte disponíveis)
router.get('/status', async (req: AuthRequest, res: Response) => {
  if (!isImageGenEnabled()) {
    res.json({ imageGenEnabled: false });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const plan = await getUserPlan(user?.supabaseUserId);
  const isTrial = !isPaidPlan(plan);
  const trialGenerationsLeft = Math.max(0, TRIAL_GENERATION_LIMIT - (user?.creativeGenerationsUsed ?? 0));

  res.json({
    imageGenEnabled: !isTrial || trialGenerationsLeft > 0,
    isTrial,
    trialGenerationsLeft: isTrial ? trialGenerationsLeft : null,
  });
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

  // Controle de custo: usuários em trial têm direito a TRIAL_GENERATION_LIMIT
  // gerações completas (1 imagem + 1 copy). Depois disso, continuam podendo
  // gerar copies/conceitos, mas sem arte real (custo zero).
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const plan = await getUserPlan(user?.supabaseUserId);
  const isTrial = !isPaidPlan(plan);
  const trialHasArtLeft = user!.creativeGenerationsUsed < TRIAL_GENERATION_LIMIT;
  const allowArt = isImageGenEnabled() && (!isTrial || trialHasArtLeft);

  const effectiveCount = isTrial && trialHasArtLeft ? 1 : Math.min(Math.max(count ?? 6, 1), 6);

  // 1. Copies + conceitos + prompts de imagem (uma única chamada à IA)
  const { variations } = await ai.generateCreativeSet({
    product, audience, objective, differentials, tone, niche, businessName, count: effectiveCount,
  });

  if (variations.length === 0) {
    res.status(502).json({ error: 'A IA não retornou variações. Tente novamente.' });
    return;
  }

  // 2. Arte real (em paralelo) — só roda se FAL_KEY estiver configurada e o
  // usuário ainda tiver direito a arte (plano pago, ou trial dentro do limite)
  const aspectRatio: CreativeAspect = aspect ?? '1:1';
  const imageUrls = allowArt
    ? await generateImages(variations.map((v) => v.imagePrompt), aspectRatio)
    : variations.map(() => null);

  if (isTrial && trialHasArtLeft && isImageGenEnabled()) {
    await prisma.user.update({
      where: { id: req.userId! },
      data: { creativeGenerationsUsed: { increment: 1 } },
    });
  }

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

  res.json({ creatives, imageGenEnabled: allowArt });
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
