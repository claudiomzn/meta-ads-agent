import { Router, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { PixelService } from '../services/pixel.service.js';

const router = Router();

router.use(authMiddleware);

// GET /api/pixel/status — verifica se o usuário já tem um Pixel conectado
router.get('/status', async (req: AuthRequest, res: Response) => {
  const svc = new PixelService(req.userId!);
  const status = await svc.getStatus();
  res.json(status);
});

// POST /api/pixel/create — busca um Pixel existente na conta ou cria um novo
router.post('/create', async (req: AuthRequest, res: Response) => {
  const svc = new PixelService(req.userId!);
  const status = await svc.createOrGetPixel();
  res.json(status);
});

export default router;
