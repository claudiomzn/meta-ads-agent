import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { InstagramService } from '../services/instagram.service.js';

const router = Router();
router.use(authMiddleware);

// GET /api/instagram/account — dados da conta IG
router.get('/account', async (req: AuthRequest, res: Response) => {
  try {
    const svc = new InstagramService(req.userId!);
    const account = await svc.getAccount();
    res.json(account);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    res.status(400).json({ error: msg });
  }
});

// GET /api/instagram/posts — lista posts com insights
router.get('/posts', async (req: AuthRequest, res: Response) => {
  try {
    const svc = new InstagramService(req.userId!);
    const account = await svc.getAccount();
    const posts = await svc.getPosts(account.id, 30);
    res.json({ account, posts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    res.status(400).json({ error: msg });
  }
});

// POST /api/instagram/analyze — análise IA dos posts
router.post('/analyze', async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada.' });
      return;
    }
    const svc = new InstagramService(req.userId!);
    const account = await svc.getAccount();
    const posts = await svc.getPosts(account.id, 30);
    const analysis = await svc.analyzeWithAI(posts, account);
    res.json({ account, posts, analysis });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    res.status(400).json({ error: msg });
  }
});

export default router;
