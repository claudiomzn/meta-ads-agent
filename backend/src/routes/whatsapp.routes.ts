import { Router, Request, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { WhatsappService } from '../services/whatsapp/whatsapp.service.js';
import { resolveTransport } from '../services/whatsapp/transport.js';
import {
  evolutionConfigured,
  connectInstance,
  disconnectInstance,
  getConnectionState,
  instanceName,
  webhookSecret,
  webhookUrl,
} from '../services/whatsapp/evolution.manager.js';
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

// ── Evolution gerenciada (WhatsApp do AdsGenius, 1 clique + QR) ───────────────

// Cria/renova a instância do usuário na Evolution central, configura o webhook
// e devolve o QR pra escanear. Também já grava transport=evolution na config
// do bot (só a instância — baseUrl/apiKey vêm do env do servidor).
router.post('/evolution/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) {
    return res.status(503).json({ error: 'WhatsApp gerenciado indisponível no momento (Evolution central não configurada)' });
  }
  const userId = req.userId!;
  const result = await connectInstance(userId);

  // Aponta a config do bot para a instância gerenciada, preservando o resto.
  const existing = await prisma.whatsappConfig.findUnique({ where: { userId } });
  const data = { transport: 'evolution', transportConfig: { instance: instanceName(userId) } };
  if (existing) {
    await prisma.whatsappConfig.update({ where: { userId }, data });
  } else {
    await prisma.whatsappConfig.create({
      data: { userId, businessName: 'Meu Negócio', product: '', ...data },
    });
  }

  res.json(result);
});

// Estado da conexão: "open" = WhatsApp conectado e recebendo mensagens.
router.get('/evolution/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) return res.json({ available: false, state: 'unavailable' });
  const state = await getConnectionState(req.userId!);
  res.json({ available: true, state, connected: state === 'open' });
});

// Desconecta a sessão do WhatsApp (logout). A instância continua existindo;
// reconectar gera um QR novo.
router.post('/evolution/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) return res.status(503).json({ error: 'Evolution central não configurada' });
  await disconnectInstance(req.userId!);
  res.json({ ok: true });
});

// Devolve a URL completa do webhook (com o segredo) para a UI exibir no modo
// self-hosted — o frontend não consegue calcular o HMAC sozinho.
router.get('/webhook-url', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ url: webhookUrl(req.userId!) });
});

// ── Webhook (público) — recebe mensagens do provedor de WhatsApp ──────────────
// O userId vem na URL porque o provedor não conhece nossa autenticação; o
// segredo ?key= impede injeção de mensagens falsas por quem souber um userId.
// Ex: POST /api/whatsapp/webhook/<userId>?key=<hmac>
router.post('/webhook/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  // Chave errada/ausente: responde 200 (pra não gerar loop de reentrega no
  // provedor) mas NÃO processa nada. Log pra diagnóstico.
  if (String(req.query.key ?? '') !== webhookSecret(userId)) {
    console.warn(`[whatsapp:webhook] chave inválida p/ ${userId} — mensagem descartada`);
    return res.json({ ok: true });
  }

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
