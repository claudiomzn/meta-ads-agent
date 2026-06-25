import { Router, Request, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { WhatsappService } from '../services/whatsapp/whatsapp.service.js';
import { resolveTransport } from '../services/whatsapp/transport.js';
import prisma from '../lib/prisma.js';

const router = Router();

// ── Config (autenticado) ─────────────────────────────────────────────────────
router.get('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!);
  res.json(await svc.getConfig());
});

router.post('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!);
  res.json(await svc.upsertConfig(req.body ?? {}));
});

// Lista conversas do usuário (para acompanhamento no painel)
router.get('/conversations', authMiddleware, async (req: AuthRequest, res: Response) => {
  const list = await prisma.whatsappConversation.findMany({
    where: { userId: req.userId! },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  res.json(list);
});

// ── Teste manual do fluxo (autenticado) — simula uma mensagem de lead ─────────
// Permite validar o bot ponta-a-ponta com o transporte "log", sem WhatsApp real.
router.post('/simulate', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { from, text } = req.body ?? {};
  if (!from || !text) return res.status(400).json({ error: 'from e text são obrigatórios' });
  const svc = new WhatsappService(req.userId!);
  const result = await svc.handleInbound({ from, text, transport: 'log' });
  res.json(result ?? { skipped: 'bot desligado ou sem config' });
});

// ── Webhook (público) — recebe mensagens do provedor de WhatsApp ──────────────
// O userId vem na URL porque o provedor não conhece nossa autenticação.
// Ex: POST /api/whatsapp/webhook/<userId>
router.post('/webhook/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const svc = new WhatsappService(userId);
    const config = await svc.getConfig();
    if (!config) return res.status(404).json({ error: 'config não encontrada' });

    const transport = resolveTransport(config.transport, config.transportConfig as Record<string, unknown>);
    const msg = transport.parseInbound(req.body);
    // Sempre responde 200 rápido ao provedor (evita reentrega); processa o que der.
    if (msg) {
      svc.handleInbound(msg).catch((e) => console.error('[whatsapp:webhook] erro:', e));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[whatsapp:webhook] falha:', e);
    res.json({ ok: true }); // 200 mesmo em erro p/ não gerar reentrega em loop
  }
});

export default router;
