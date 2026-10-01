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

// POST /api/capi/purchase — venda fechada que o cliente registrou no app.
// body: { saleId, phone, value, closedAt? ("AAAA-MM-DD") }
//
// O event_id é derivado do saleId: reenviar a mesma venda (clique duplo,
// retentativa) não conta duas vezes no Meta.
//
// O valor vem do app do próprio dono da conta e só alimenta o Pixel DELE —
// inflar o número só piora a otimização da própria conta.
router.post('/purchase', async (req: AuthRequest, res: Response) => {
  const { saleId, phone, value, closedAt } = req.body ?? {};
  if (typeof saleId !== 'string' || !/^[\w-]{1,64}$/.test(saleId)) {
    return res.status(400).json({ ok: false, error: 'saleId inválido.' });
  }
  const digitos = String(phone ?? '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) {
    return res.status(400).json({ ok: false, error: 'Telefone do cliente inválido.' });
  }
  const valor = Number(value);
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ ok: false, error: 'Valor da venda inválido.' });
  }
  let eventTime: number | undefined;
  if (closedAt != null) {
    if (typeof closedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(closedAt)) {
      return res.status(400).json({ ok: false, error: 'Data da venda inválida.' });
    }
    eventTime = momentoDaVenda(closedAt);
    if (!Number.isFinite(eventTime)) {
      return res.status(400).json({ ok: false, error: 'Data da venda inválida.' });
    }
  }

  const svc = new CapiService(req.userId!);
  res.json(await svc.sendPurchase({ phone: digitos, eventId: `venda_${saleId}`, value: valor, eventTime }));
});

/**
 * "AAAA-MM-DD" (data local de Manaus) → epoch em segundos.
 * Venda de hoje vira "agora": meio-dia de hoje pode estar no futuro, e o Meta
 * recusa evento com data futura. Dia anterior vira meio-dia daquele dia.
 */
export function momentoDaVenda(closedAt: string, agora = Date.now()): number {
  const meioDia = Date.parse(`${closedAt}T12:00:00-04:00`);
  return Math.floor(Math.min(meioDia, agora) / 1000);
}

export default router;
