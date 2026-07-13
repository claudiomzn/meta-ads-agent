import { Router, Request, Response } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { WhatsappService, creditPaidRecharge, DEFAULT_BUSINESS } from '../services/whatsapp/whatsapp.service.js';
import { resolveTransport } from '../services/whatsapp/transport.js';
import {
  evolutionConfigured,
  connectInstance,
  disconnectInstance,
  deleteInstance,
  getConnectionState,
  instanceName,
  webhookSecret,
  webhookUrl,
} from '../services/whatsapp/evolution.manager.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Extrai o businessId da requisição autenticada (query OU body) — ausente
// (fluxo de sempre, retrocompatível) cai no negócio "default". O frontend
// (Fase 2) envia explicitamente quando o usuário tiver >1 negócio.
function resolveBusinessId(req: AuthRequest): string {
  const raw = (req.query.businessId as string | undefined) ?? (req.body?.businessId as string | undefined);
  return raw && String(raw).trim() ? String(raw).trim() : DEFAULT_BUSINESS;
}

// ── Config (autenticado) ─────────────────────────────────────────────────────
router.get('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!, resolveBusinessId(req));
  res.json(await svc.getConfig());
});

router.post('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!, resolveBusinessId(req));
  res.json(await svc.upsertConfig(req.body ?? {}));
});

// Limite diário, excedente acumulado e histórico de cobranças (Asaas) — por negócio
router.get('/usage', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!, resolveBusinessId(req));
  res.json(await svc.getUsageStatus());
});

// Lista conversas do usuário (para acompanhamento no painel) — por negócio
router.get('/conversations', authMiddleware, async (req: AuthRequest, res: Response) => {
  const businessId = resolveBusinessId(req);
  const list = await prisma.whatsappConversation.findMany({
    where: { userId: req.userId!, businessId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  res.json(list);
});

// ── Negócios da conta (multi-negócio) ─────────────────────────────────────────
// Lista os negócios (bots) desta conta para o seletor do painel. Contas de
// hoje (1 config, sem negócio explícito) aparecem com um único item
// businessId="default". Marca "connected" via Evolution quando gerenciado.
router.get('/businesses', authMiddleware, async (req: AuthRequest, res: Response) => {
  const svc = new WhatsappService(req.userId!);
  const businesses = await svc.listBusinesses();

  const withConnection = await Promise.all(
    businesses.map(async (b) => {
      let connected: boolean | null = null;
      if (evolutionConfigured() && b.transport === 'evolution') {
        try {
          const state = await getConnectionState(req.userId!, b.businessId);
          connected = state === 'open';
        } catch {
          connected = null; // indisponível — painel trata como "desconhecido"
        }
      }
      return {
        businessId: b.businessId,
        businessName: b.businessName,
        enabled: b.enabled,
        transport: b.transport,
        connected,
        isDefault: b.businessId === DEFAULT_BUSINESS,
      };
    }),
  );

  res.json(withConnection);
});

// Cria um negócio novo (id gerado no servidor) — o frontend chama isto para
// abrir o formulário de um 2º+ negócio; a config em si é preenchida depois
// via POST /config?businessId=<retornado aqui>.
router.post('/businesses', authMiddleware, async (req: AuthRequest, res: Response) => {
  const businessId = `biz_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const svc = new WhatsappService(req.userId!, businessId);
  const config = await svc.upsertConfig(req.body ?? {});
  res.status(201).json(config);
});

// Remove um negócio (não o "default"): desativa a config e apaga a instância
// Evolution associada (se houver). NÃO apaga conversas — o histórico fica.
router.delete('/businesses/:businessId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { businessId } = req.params;
  if (businessId === DEFAULT_BUSINESS) {
    return res.status(400).json({ error: 'O negócio padrão não pode ser removido' });
  }
  const svc = new WhatsappService(req.userId!, businessId);
  try {
    await svc.removeBusiness();
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
  if (evolutionConfigured()) {
    await deleteInstance(req.userId!, businessId).catch((e) =>
      console.warn(`[whatsapp:businesses] falha ao apagar instância Evolution (${req.userId}/${businessId}):`, e));
  }
  res.json({ ok: true });
});

// ── Teste manual do fluxo (autenticado) — simula uma mensagem de lead ─────────
// Permite validar o bot ponta-a-ponta com o transporte "log", sem WhatsApp real.
router.post('/simulate', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { from, text } = req.body ?? {};
  if (!from || !text) return res.status(400).json({ error: 'from e text são obrigatórios' });
  const svc = new WhatsappService(req.userId!, resolveBusinessId(req));
  const result = await svc.handleInbound({ from, text, transport: 'log' });
  res.json(result ?? { skipped: 'bot desligado ou sem config' });
});

// ── Evolution gerenciada (WhatsApp do AdsGenius, 1 clique + QR) ───────────────

// Cria/renova a instância do usuário (+ negócio) na Evolution central,
// configura o webhook e devolve o QR pra escanear. Também já grava
// transport=evolution na config do bot (só a instância — baseUrl/apiKey vêm
// do env do servidor).
router.post('/evolution/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) {
    return res.status(503).json({ error: 'WhatsApp gerenciado indisponível no momento (Evolution central não configurada)' });
  }
  const userId = req.userId!;
  const businessId = resolveBusinessId(req);
  const result = await connectInstance(userId, businessId);

  // Aponta a config do bot para a instância gerenciada, preservando o resto.
  const existing = await prisma.whatsappConfig.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
  const data = { transport: 'evolution', transportConfig: { instance: instanceName(userId, businessId) } };
  if (existing) {
    await prisma.whatsappConfig.update({
      where: { userId_businessId: { userId, businessId } },
      data,
    });
  } else {
    await prisma.whatsappConfig.create({
      data: { userId, businessId, businessName: 'Meu Negócio', product: '', ...data },
    });
  }

  res.json(result);
});

// Estado da conexão: "open" = WhatsApp conectado e recebendo mensagens.
router.get('/evolution/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) return res.json({ available: false, state: 'unavailable' });
  const state = await getConnectionState(req.userId!, resolveBusinessId(req));
  res.json({ available: true, state, connected: state === 'open' });
});

// Desconecta a sessão do WhatsApp (logout). A instância continua existindo;
// reconectar gera um QR novo.
router.post('/evolution/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!evolutionConfigured()) return res.status(503).json({ error: 'Evolution central não configurada' });
  await disconnectInstance(req.userId!, resolveBusinessId(req));
  res.json({ ok: true });
});

// Devolve a URL completa do webhook (com o segredo) para a UI exibir no modo
// self-hosted — o frontend não consegue calcular o HMAC sozinho.
router.get('/webhook-url', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ url: webhookUrl(req.userId!, resolveBusinessId(req)) });
});

// ── Webhook (público) — recebe mensagens do provedor de WhatsApp ──────────────
// O userId (+ businessId) vem na URL porque o provedor não conhece nossa
// autenticação; o segredo ?key= impede injeção de mensagens falsas por quem
// souber um userId/businessId.
// Ex: POST /api/whatsapp/webhook/<userId>/<businessId>?key=<hmac>
router.post('/webhook/:userId/:businessId', async (req: Request, res: Response) => {
  const { userId, businessId } = req.params;

  if (String(req.query.key ?? '') !== webhookSecret(userId, businessId)) {
    console.warn(`[whatsapp:webhook] chave inválida p/ ${userId}/${businessId} — mensagem descartada`);
    return res.json({ ok: true });
  }

  try {
    const svc = new WhatsappService(userId, businessId);
    const config = await svc.getConfig();
    if (!config) return res.status(404).json({ error: 'config não encontrada' });

    const transport = resolveTransport(config.transport, config.transportConfig as Record<string, unknown>);
    const msg = transport.parseInbound(req.body);
    if (msg) {
      svc.handleInbound(msg).catch((e) => console.error('[whatsapp:webhook] erro:', e));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[whatsapp:webhook] falha:', e);
    res.json({ ok: true });
  }
});

// ── Webhook do Asaas (público) — confirma pagamento das recargas ─────────────
// Configurar no painel do Asaas: Integrações → Webhooks → esta URL, eventos
// PAYMENT_RECEIVED e PAYMENT_CONFIRMED, com o "Token de acesso" = ASAAS_WEBHOOK_TOKEN
// (o Asaas devolve esse token no header abaixo em toda chamada).
//
// IMPORTANTE: precisa ser registrada ANTES de '/webhook/:userId' — como as
// duas rotas têm o mesmo formato de path (1 segmento após /webhook/), o
// Express casa na ordem de registro, não por especificidade. Com
// '/webhook/:userId' primeiro, TODA chamada a '/webhook/asaas' caía nesse
// handler genérico (userId="asaas"), a checagem de ?key= falhava e o evento
// era descartado silenciosamente — o webhook de pagamento nunca rodava
// creditPaidRecharge. Bug pré-existente (não introduzido por multi-negócio),
// corrigido aqui na mesma passada por tocar exatamente este arquivo/fluxo.
router.post('/webhook/asaas', async (req: Request, res: Response) => {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  const received = req.headers['asaas-access-token'];
  if (!expected || received !== expected) {
    console.warn('[whatsapp:webhook:asaas] token inválido/ausente — evento descartado');
    return res.json({ ok: true }); // 200 pra não gerar reentrega em loop
  }

  try {
    const { event, payment } = req.body ?? {};
    if ((event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') && payment?.id) {
      await creditPaidRecharge(payment.id);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[whatsapp:webhook:asaas] falha:', e);
    res.json({ ok: true });
  }
});

// Rota antiga — SEM businessId na URL — continua roteando pro negócio
// "default". Instâncias criadas antes de multi-negócio já apontam pra cá;
// preservar isto evita que elas caiam (não precisam reconectar).
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
