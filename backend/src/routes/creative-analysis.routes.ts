import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import {
  analyzeImage,
  compareCreatives,
  analyzeHistoricalPatterns,
} from '../services/creative-analysis.service.js';

const router = Router();
router.use(authMiddleware);

// ── Upload config ─────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'creatives');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = /image\/(jpeg|png|gif|webp)/;
    cb(null, allowed.test(file.mimetype));
  },
});

// ── POST /analyze ─────────────────────────────────────────────────────────────
router.post('/analyze', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Arquivo de imagem obrigatório' });
    return;
  }

  const { adId, campaignId, adAccountId, headline, body, cta } = req.body as {
    adId?: string; campaignId?: string; adAccountId?: string;
    headline?: string; body?: string; cta?: string;
  };

  const copy = (headline || body || cta) ? { headline, body, cta } : undefined;

  try {
    const result = await analyzeImage(req.file.path, copy);

    const record = await prisma.creativeAnalysis.create({
      data: {
        userId: req.userId!,
        adId: adId ?? null,
        campaignId: campaignId ?? null,
        adAccountId: adAccountId ?? null,
        filePath: req.file.path,
        fileType: req.file.mimetype,
        fileName: req.file.originalname,
        copyHeadline: headline ?? null,
        copyBody: body ?? null,
        copyCta: cta ?? null,
        overallScore: result.overallScore,
        approvalRecommendation: result.approvalRecommendation,
        approvalReason: result.approvalReason,
        summary: result.summary,
        criteriaScores: JSON.stringify(result.criteria),
        formatScores: JSON.stringify(result.formatScores),
        strengths: JSON.stringify(result.strengths),
        improvements: JSON.stringify(result.improvements),
      },
    });

    res.json({ ...record, analysis: result });
  } catch (err) {
    // Limpa arquivo se falhar
    fs.unlink(req.file.path, () => {});
    console.error('[creative-analysis] Erro ao analisar:', err);
    res.status(500).json({ error: 'Erro ao analisar criativo. Tente novamente.' });
  }
});

// ── POST /compare ─────────────────────────────────────────────────────────────
router.post('/compare', upload.fields([
  { name: 'fileA', maxCount: 1 },
  { name: 'fileB', maxCount: 1 },
]), async (req: AuthRequest, res: Response) => {
  const files = req.files as Record<string, Express.Multer.File[]>;
  const fileA = files?.fileA?.[0];
  const fileB = files?.fileB?.[0];

  if (!fileA || !fileB) {
    res.status(400).json({ error: 'Dois arquivos (fileA e fileB) são obrigatórios' });
    return;
  }

  const { campaignId, adAccountId,
    headlineA, bodyA, ctaA,
    headlineB, bodyB, ctaB } = req.body as Record<string, string>;

  const copyA = (headlineA || bodyA || ctaA) ? { headline: headlineA, body: bodyA, cta: ctaA } : undefined;
  const copyB = (headlineB || bodyB || ctaB) ? { headline: headlineB, body: bodyB, cta: ctaB } : undefined;

  try {
    const result = await compareCreatives(fileA.path, fileB.path, copyA, copyB);

    // Salva os dois criativos com flag isComparison
    const [recordA, recordB] = await Promise.all([
      prisma.creativeAnalysis.create({
        data: {
          userId: req.userId!,
          campaignId: campaignId ?? null,
          adAccountId: adAccountId ?? null,
          filePath: fileA.path,
          fileType: fileA.mimetype,
          fileName: fileA.originalname,
          copyHeadline: headlineA ?? null,
          copyBody: bodyA ?? null,
          copyCta: ctaA ?? null,
          overallScore: result.analysisA.overallScore,
          approvalRecommendation: result.analysisA.approvalRecommendation,
          approvalReason: result.analysisA.approvalReason,
          summary: result.analysisA.summary,
          criteriaScores: JSON.stringify(result.analysisA.criteria),
          formatScores: JSON.stringify(result.analysisA.formatScores),
          strengths: JSON.stringify(result.analysisA.strengths),
          improvements: JSON.stringify(result.analysisA.improvements),
          isComparison: true,
          comparisonWinner: result.winner === 'A' ? 'this' : result.winner === 'B' ? 'other' : 'draw',
          comparisonDetails: JSON.stringify(result),
        },
      }),
      prisma.creativeAnalysis.create({
        data: {
          userId: req.userId!,
          campaignId: campaignId ?? null,
          adAccountId: adAccountId ?? null,
          filePath: fileB.path,
          fileType: fileB.mimetype,
          fileName: fileB.originalname,
          copyHeadline: headlineB ?? null,
          copyBody: bodyB ?? null,
          copyCta: ctaB ?? null,
          overallScore: result.analysisB.overallScore,
          approvalRecommendation: result.analysisB.approvalRecommendation,
          approvalReason: result.analysisB.approvalReason,
          summary: result.analysisB.summary,
          criteriaScores: JSON.stringify(result.analysisB.criteria),
          formatScores: JSON.stringify(result.analysisB.formatScores),
          strengths: JSON.stringify(result.analysisB.strengths),
          improvements: JSON.stringify(result.analysisB.improvements),
          isComparison: true,
          comparisonWinner: result.winner === 'B' ? 'this' : result.winner === 'A' ? 'other' : 'draw',
          comparisonDetails: JSON.stringify(result),
        },
      }),
    ]);

    // Vincula os dois entre si
    await Promise.all([
      prisma.creativeAnalysis.update({ where: { id: recordA.id }, data: { comparedWithId: recordB.id } }),
      prisma.creativeAnalysis.update({ where: { id: recordB.id }, data: { comparedWithId: recordA.id } }),
    ]);

    res.json({ idA: recordA.id, idB: recordB.id, comparison: result });
  } catch (err) {
    [fileA, fileB].forEach((f) => fs.unlink(f.path, () => {}));
    console.error('[creative-analysis] Erro na comparação:', err);
    res.status(500).json({ error: 'Erro ao comparar criativos. Tente novamente.' });
  }
});

// ── GET / (lista paginada) ────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Number(req.query.limit ?? 20));
  const filter = req.query.filter as string | undefined; // aprovado | aprovar_com_ressalvas | reprovar

  const where = {
    userId: req.userId!,
    ...(filter ? { approvalRecommendation: filter } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.creativeAnalysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, fileName: true, fileType: true, overallScore: true,
        approvalRecommendation: true, summary: true,
        realCtr: true, realCpl: true, isComparison: true,
        campaignId: true, adId: true,
        createdAt: true,
      },
    }),
    prisma.creativeAnalysis.count({ where }),
  ]);

  res.json({ items, total, page, totalPages: Math.ceil(total / limit) });
});

// ── GET /patterns/:adAccountId ────────────────────────────────────────────────
router.get('/patterns/:adAccountId', async (req: AuthRequest, res: Response) => {
  const { adAccountId } = req.params;
  const result = await analyzeHistoricalPatterns(req.userId!, adAccountId);
  res.json(result);
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const record = await prisma.creativeAnalysis.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) { res.status(404).json({ error: 'Análise não encontrada' }); return; }

  res.json({
    ...record,
    criteriaScores: JSON.parse(record.criteriaScores),
    formatScores: JSON.parse(record.formatScores),
    strengths: JSON.parse(record.strengths),
    improvements: JSON.parse(record.improvements),
    comparisonDetails: record.comparisonDetails ? JSON.parse(record.comparisonDetails) : null,
  });
});

// ── PATCH /:id/metrics ────────────────────────────────────────────────────────
router.patch('/:id/metrics', async (req: AuthRequest, res: Response) => {
  const { realCtr, realCpl, realRoas, realImpressions } = req.body as {
    realCtr?: number; realCpl?: number; realRoas?: number; realImpressions?: number;
  };
  const record = await prisma.creativeAnalysis.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) { res.status(404).json({ error: 'Análise não encontrada' }); return; }

  const updated = await prisma.creativeAnalysis.update({
    where: { id: req.params.id },
    data: {
      ...(realCtr != null ? { realCtr } : {}),
      ...(realCpl != null ? { realCpl } : {}),
      ...(realRoas != null ? { realRoas } : {}),
      ...(realImpressions != null ? { realImpressions } : {}),
    },
  });
  res.json(updated);
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const record = await prisma.creativeAnalysis.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) { res.status(404).json({ error: 'Análise não encontrada' }); return; }

  // Remove arquivo físico
  fs.unlink(record.filePath, () => {});
  await prisma.creativeAnalysis.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
