import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { generateImages, isImageGenEnabled, type CreativeAspect } from '../services/image.service.js';
import { rehostImage } from '../services/storage.service.js';
import { getUserPlan, isPaidPlan, isLifetimeUser } from '../services/plan.service.js';

const router = Router();
const ai = new AIService();

// Cota de artes (imagens) geradas com IA:
// - Trial: cota única (vitalícia) durante todo o período de teste.
// - Pro/Agência: cota mensal, resetada automaticamente a cada novo mês.
const TRIAL_GENERATION_LIMIT = Number(process.env.CREATIVE_STUDIO_TRIAL_LIMIT ?? 1);
const PRO_MONTHLY_LIMIT = Number(process.env.CREATIVE_STUDIO_PRO_LIMIT ?? 24);
const AGENCY_MONTHLY_LIMIT = Number(process.env.CREATIVE_STUDIO_AGENCY_LIMIT ?? 50);

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

type QuotaUser = { email: string; creativeGenerationsUsed: number; creativeGenerationsMonth: string | null };

function getQuota(plan: string | null, user: QuotaUser) {
  const month = currentMonthKey();

  // Acesso vitalício/interno: sem limites de cota
  if (isLifetimeUser(user.email)) {
    return { isTrial: false, limit: Infinity, used: 0, resetMonth: false, month };
  }

  const isTrial = !isPaidPlan(plan);

  if (isTrial) {
    return { isTrial, limit: TRIAL_GENERATION_LIMIT, used: user.creativeGenerationsUsed, resetMonth: false, month };
  }

  const limit = plan === 'agency' ? AGENCY_MONTHLY_LIMIT : PRO_MONTHLY_LIMIT;
  const resetMonth = user.creativeGenerationsMonth !== month;
  const used = resetMonth ? 0 : user.creativeGenerationsUsed;
  return { isTrial, limit, used, resetMonth, month };
}

router.use(authMiddleware);

// Informa ao frontend se a geração de arte real está ativa (FAL_KEY configurada)
// e quantas artes ainda restam na cota do usuário (trial vitalícia, ou mensal
// para Pro/Agência)
router.get('/status', async (req: AuthRequest, res: Response) => {
  if (!isImageGenEnabled()) {
    res.json({ imageGenEnabled: false, generationsLeft: 0, monthlyLimit: null, isTrial: null });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const plan = await getUserPlan(user?.supabaseUserId);
  const quota = getQuota(plan, user!);
  const generationsLeft = Math.max(0, quota.limit - quota.used);

  res.json({
    imageGenEnabled: generationsLeft > 0,
    isTrial: quota.isTrial,
    generationsLeft,
    monthlyLimit: quota.isTrial ? null : quota.limit,
    trialGenerationsLeft: quota.isTrial ? generationsLeft : null,
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

  // Controle de custo: cada usuário tem uma cota de artes (imagens) geradas
  // com IA — vitalícia no trial, mensal (resetada automaticamente) no Pro/Agência.
  // Acima da cota, o estúdio continua gerando copy + conceito visual (custo zero).
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const plan = await getUserPlan(user?.supabaseUserId);
  const quota = getQuota(plan, user!);
  const generationsLeft = Math.max(0, quota.limit - quota.used);

  // No trial, a primeira geração entrega 1 criativo completo (1 arte + copy);
  // depois disso, segue gerando o conjunto normal de copies sem arte.
  const aiCount = quota.isTrial
    ? (generationsLeft > 0 ? 1 : 6)
    : Math.min(Math.max(count ?? 6, 1), 6);

  // 1. Copies + conceitos + prompts de imagem (uma única chamada à IA)
  const { variations } = await ai.generateCreativeSet({
    product, audience, objective, differentials, tone, niche, businessName, count: aiCount,
  });

  if (variations.length === 0) {
    res.status(502).json({ error: 'A IA não retornou variações. Tente novamente.' });
    return;
  }

  // 2. Arte real (em paralelo) — só para as primeiras `imagesToGenerate`
  // variações, limitado pelo que resta da cota do usuário
  const aspectRatio: CreativeAspect = aspect ?? '1:1';
  const imagesToGenerate = isImageGenEnabled() ? Math.min(generationsLeft, aiCount) : 0;

  let imageUrls: (string | null)[];
  if (imagesToGenerate > 0) {
    const generated = await generateImages(
      variations.slice(0, imagesToGenerate).map((v) => v.imagePrompt),
      aspectRatio,
    );
    imageUrls = [...generated, ...variations.slice(imagesToGenerate).map(() => null)];
  } else {
    imageUrls = variations.map(() => null);
  }

  // Só consome a cota pelas imagens que a fal.ai de fato retornou — se a
  // geração falhar (ex: billing do fal.ai não configurado), não queremos
  // descontar a cota do usuário sem entregar nada em troca.
  const imagesGenerated = imageUrls.filter((u) => u !== null).length;

  if (imagesGenerated > 0) {
    if (quota.isTrial) {
      await prisma.user.update({
        where: { id: req.userId! },
        data: { creativeGenerationsUsed: { increment: imagesGenerated } },
      });
    } else {
      await prisma.user.update({
        where: { id: req.userId! },
        data: {
          creativeGenerationsUsed: quota.resetMonth ? imagesGenerated : { increment: imagesGenerated },
          creativeGenerationsMonth: quota.month,
        },
      });
    }
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

  res.json({
    creatives,
    imageGenEnabled: imagesGenerated > 0,
    generationsLeft: Math.max(0, generationsLeft - imagesGenerated),
    monthlyLimit: quota.isTrial ? null : quota.limit,
  });
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
