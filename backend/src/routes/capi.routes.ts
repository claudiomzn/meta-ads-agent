import { Router, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { CapiService } from '../services/capi.service.js';

const router = Router();

router.use(authMiddleware);

// GET /api/capi/status — CAPI pronto? (precisa de conta Meta + Pixel)
router.get('/status', async (req: AuthRequest, res: Response) => {
  const svc = new CapiService(req.userId!);
  res.json(await svc.getStatus());
});

// POST /api/capi/test — envia um evento Lead de teste. Use test_event_code do
// Gerenciador de Eventos (aba "Eventos de teste") para ver chegar em tempo real.
// body: { phone?, testEventCode }
router.post('/test', async (req: AuthRequest, res: Response) => {
  const { phone, testEventCode } = req.body ?? {};
  if (!testEventCode) {
    return res.status(400).json({ ok: false, error: 'testEventCode é obrigatório (pegue na aba Eventos de teste do Gerenciador de Eventos).' });
  }
  const svc = new CapiService(req.userId!);
  const result = await svc.sendLead({
    phone: phone || '5592999999999',
    eventId: `test_${Date.now()}`,
    testEventCode,
  });
  res.json(result);
});

export default router;
