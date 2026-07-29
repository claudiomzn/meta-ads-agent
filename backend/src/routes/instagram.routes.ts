import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { InstagramService } from '../services/instagram.service.js';
import { aiBudget } from '../middleware/aiBudget.middleware.js';

const router = Router();
router.use(authMiddleware);

// GET /api/instagram/account — dados da conta IG
router.get('/account', async (req: AuthRequest, res: Response) => {
  try {
    const svc = new InstagramService(req.userId!);
    const account = await svc.getAccount();
    res.json(account);
  } catch (err: unknown) {
    console.error('[instagram:account]', err);
    res.status(400).json({ error: 'Não foi possível carregar a conta do Instagram.' });
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
    console.error('[instagram:posts]', err);
    res.status(400).json({ error: 'Não foi possível carregar os posts do Instagram.' });
  }
});

// POST /api/instagram/analyze — análise IA dos posts
router.post('/analyze', aiBudget('agent_chat'), async (req: AuthRequest, res: Response) => {
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
    console.error('[instagram:analyze]', err);
    res.status(400).json({ error: 'Não foi possível analisar o Instagram.' });
  }
});

export default router;
