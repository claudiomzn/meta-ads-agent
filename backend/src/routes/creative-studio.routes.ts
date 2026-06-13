import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { generateImages, isImageGenEnabled, type CreativeAspect } from '../services/image.service.js';

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

export default router;
