import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AnalysisService } from '../services/analysis.service.js';

const router = Router();
const svc = new AnalysisService();

// GET /api/analysis — lista análises anteriores
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const insights = await svc.getInsights(req.userId!);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar análises' });
  }
});

// GET /api/analysis/:id — retorna análise completa
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const insight = await svc.getInsightById(req.userId!, req.params.id);
    if (!insight) { res.status(404).json({ error: 'Análise não encontrada' }); return; }
    res.json(insight);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar análise' });
  }
});

// POST /api/analysis/run — executa análise completa com IA
router.post('/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({
        error: 'ANTHROPIC_API_KEY não configurada. Adicione a chave no .env para usar a análise IA.',
      });
      return;
    }
    const analysis = await svc.runFullAnalysis(req.userId!);
    res.json(analysis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    res.status(500).json({ error: `Erro na análise: ${msg}` });
  }
});

export default router;
