import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { publishRateLimit } from '../middleware/rateLimit.middleware.js';
import { MetaMCPService, PublishValidationError, createMetaMCPService } from '../services/meta.mcp.service.js';
import { MediaService } from '../services/media.service.js';
import { SyncService } from '../services/sync.service.js';
import { encrypt } from '../services/crypto.service.js';
import { auditLog } from '../services/audit.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const router = Router();

// ─── Webhook Meta (sem autenticação — chamado pelo Meta) ──────────────────────

router.get('/webhook', (req: AuthRequest, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Verificação de webhook falhou' });
  }
});

router.post('/webhook', async (req: AuthRequest, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    // Sem APP_SECRET configurado: rejeita em produção, aceita em desenvolvimento
    if (process.env.NODE_ENV === 'production') {
      console.error('[Webhook] META_APP_SECRET não configurado — requisição bloqueada em produção');
      res.status(401).json({ error: 'Webhook não configurado corretamente' });
      return;
    }
    console.warn('[Webhook] META_APP_SECRET ausente — aceitando sem verificação (desenvolvimento)');
  } else {
    if (!signature) {
      res.status(401).json({ error: 'Assinatura ausente' });
      return;
    }
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (signature !== expected) {
      res.status(401).json({ error: 'Assinatura inválida' });
      return;
    }
  }

  res.status(200).json({ received: true });

  const adAccountId = req.body?.entry?.[0]?.id;
  if (adAccountId) {
    const conn = await prisma.mCPConnection.findFirst({
      where: { adAccountIds: { contains: adAccountId } },
    });
    if (conn) {
      const syncSvc = new SyncService(conn.userId);
      syncSvc.handleMetaWebhook(req.body).catch(console.error);
    }
  }
});

// Todos os endpoints abaixo exigem autenticação
router.use(authMiddleware);

// ─── Conexão ──────────────────────────────────────────────────────────────────

const ConnectSchema = z.object({
  // Para Pipeboard/Zapier o token Meta é opcional — a autenticação já está na URL
  accessToken: z.string().optional().default(''),
  mcpUrl: z.string().url(),
  mcpProvider: z.enum(['meta', 'pipeboard', 'zapier']),
  adAccountIds: z.array(z.string()).min(1),
});

router.post('/connect', async (req: AuthRequest, res: Response) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const messages = Object.entries(fieldErrors)
      .map(([field, errs]) => `${field}: ${(errs as string[]).join(', ')}`)
      .join(' | ');
    res.status(400).json({ error: messages || 'Dados inválidos' });
    return;
  }

  const { accessToken, mcpUrl, mcpProvider, adAccountIds } = parsed.data;

  // Para Meta direto, valida o token fazendo uma chamada de teste
  // Para Pipeboard/Zapier, a auth já está embutida na URL — não precisa de token Meta
  if (mcpProvider === 'meta' && !accessToken) {
    res.status(400).json({ error: 'Token de acesso Meta é obrigatório para o provedor Meta Oficial.' });
    return;
  }

  if (mcpProvider === 'meta') {
    const svc = new MetaMCPService(req.userId!);
    try {
      await svc.connect(encrypt(accessToken), mcpUrl);
      await svc.listAdAccounts();
      await svc.disconnect();
    } catch (err) {
      res.status(400).json({ error: `Falha ao conectar ao MCP: ${String(err)}` });
      return;
    }
  }

  // Token armazenado: Meta token para provedor 'meta', ou placeholder para Pipeboard/Zapier
  const tokenToStore = accessToken || `pipeboard:${mcpProvider}`;

  await prisma.mCPConnection.upsert({
    where: { userId: req.userId! },
    update: {
      metaAccessToken: encrypt(tokenToStore),
      mcpUrl,
      mcpProvider,
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
      lastConnectedAt: new Date(),
    },
    create: {
      userId: req.userId!,
      metaAccessToken: encrypt(tokenToStore),
      mcpUrl,
      mcpProvider,
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
      lastConnectedAt: new Date(),
    },
  });

  await auditLog({ userId: req.userId!, action: 'MCP_CONNECT', resource: 'mcp_connection' });

  res.json({ success: true, provider: mcpProvider, adAccountIds });
});

router.delete('/disconnect', async (req: AuthRequest, res: Response) => {
  await prisma.mCPConnection.updateMany({
    where: { userId: req.userId! },
    data: { connected: false },
  });

  await auditLog({ userId: req.userId!, action: 'MCP_DISCONNECT', resource: 'mcp_connection' });

  res.json({ success: true });
});

router.get('/status', async (req: AuthRequest, res: Response) => {
  const svc = new MetaMCPService(req.userId!);
  const status = await svc.getConnectionStatus();
  res.json(status);
});

// ─── Auto-connect usando token do servidor ────────────────────────────────────
router.post('/auto-connect', async (req: AuthRequest, res: Response) => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const mcpUrl = process.env.META_MCP_URL ?? '';

  if (!accessToken) {
    res.status(400).json({ error: 'META_ACCESS_TOKEN não configurado no servidor' });
    return;
  }

  // Usa configuração que funcionava localmente:
  // adAccountIds = nome da conta Pipeboard + MCP URL com token
  const adAccountIds = ['amazon seguros'];
  const accountsFound = [{ id: 'amazon seguros', name: 'Amazon Planos de Saúde' }];

  await prisma.mCPConnection.upsert({
    where: { userId: req.userId! },
    update: {
      metaAccessToken: encrypt(accessToken),
      mcpUrl,
      mcpProvider: 'pipeboard',
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
      lastConnectedAt: new Date(),
    },
    create: {
      userId: req.userId!,
      metaAccessToken: encrypt(accessToken),
      mcpUrl,
      mcpProvider: 'pipeboard',
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
      lastConnectedAt: new Date(),
    },
  });

  await auditLog({ userId: req.userId!, action: 'MCP_AUTO_CONNECT', resource: 'mcp_connection' });

  res.json({ success: true, accounts: accountsFound, adAccountIds });
});

// ─── Contas ───────────────────────────────────────────────────────────────────

router.get('/accounts', async (req: AuthRequest, res: Response) => {
  const svc = await createMetaMCPService(req.userId!);
  const accounts = await svc.listAdAccounts();
  await svc.disconnect();
  res.json(accounts);
});

// ─── Publicação ───────────────────────────────────────────────────────────────

router.post('/publish/dry-run', async (req: AuthRequest, res: Response) => {
  const svc = new MetaMCPService(req.userId!);
  const validation = await svc.validatePlan(req.body);
  res.json(validation);
});

router.post('/publish/:planId', publishRateLimit, async (req: AuthRequest, res: Response) => {
  const { planId } = req.params;

  const campaign = await prisma.campaign.findFirst({
    where: { id: planId, userId: req.userId! },
    include: { adSets: { include: { ads: true } } },
  });

  if (!campaign) {
    res.status(404).json({ error: 'Plano de campanha não encontrado' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const svc = await createMetaMCPService(req.userId!);

    // ── B + E: Upload local images and videos to Meta before building the plan ──
    const imageHashMap = new Map<string, string>(); // localUrl → Meta image hash
    const videoIdMap   = new Map<string, string>(); // localUrl → Meta video ID
    const mediaSvc = new MediaService(req.userId!);

    for (const adSet of campaign.adSets) {
      for (const ad of adSet.ads) {
        // Imagens
        if (ad.imageUrl?.startsWith('/api/media/file/') && !imageHashMap.has(ad.imageUrl)) {
          const filename = ad.imageUrl.replace('/api/media/file/', '');
          const filePath = path.join(UPLOAD_DIR, filename);
          if (fs.existsSync(filePath)) {
            try {
              send({ type: 'progress', message: `Enviando imagem "${filename}" para o Meta...` });
              const uploaded = await mediaSvc.uploadImage(filePath, filename);
              if (uploaded.hash) {
                imageHashMap.set(ad.imageUrl, uploaded.hash);
                send({ type: 'progress', message: `Imagem enviada (hash: ${uploaded.hash.slice(0, 8)}...)` });
              }
            } catch {
              send({ type: 'progress', message: `Aviso: falha no upload da imagem "${filename}" — continuando sem ela` });
            }
          }
        }
        // Vídeos
        if (ad.videoUrl?.startsWith('/api/media/file/') && !videoIdMap.has(ad.videoUrl)) {
          const filename = ad.videoUrl.replace('/api/media/file/', '');
          const filePath = path.join(UPLOAD_DIR, filename);
          if (fs.existsSync(filePath)) {
            try {
              send({ type: 'progress', message: `Enviando vídeo "${filename}" para o Meta...` });
              const uploaded = await mediaSvc.uploadVideo(filePath, filename);
              if (uploaded.videoId) {
                videoIdMap.set(ad.videoUrl, uploaded.videoId);
                send({ type: 'progress', message: `Vídeo enviado (ID: ${uploaded.videoId})` });
              }
            } catch {
              send({ type: 'progress', message: `Aviso: falha no upload do vídeo "${filename}" — continuando sem ele` });
            }
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    const plan = {
      localId: campaign.id,
      adAccountId: req.body.adAccountId ?? campaign.metaAdAccountId ?? '',
      name: campaign.name,
      objective: campaign.objective,
      adSets: campaign.adSets.map((as) => ({
        name: as.name,
        dailyBudget: as.dailyBudget,
        targeting: JSON.parse(as.targeting),
        optimizationGoal: as.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        ads: as.ads.map((ad) => {
          const imageHash = ad.imageUrl ? imageHashMap.get(ad.imageUrl) : undefined;
          const videoId   = ad.videoUrl ? videoIdMap.get(ad.videoUrl) : undefined;
          return {
            name: ad.name,
            headline: ad.headline,
            bodyText: ad.bodyText,
            ctaType: ad.cta,
            destinationUrl: ad.destinationUrl ?? req.body.destinationUrl ?? 'https://example.com',
            // Imagem: usa hash (upload feito) → fallback URL original
            ...(imageHash
              ? { imageHash }
              : ad.imageUrl ? { imageUrl: ad.imageUrl } : {}),
            // Vídeo: usa videoId (upload feito) → fallback URL original
            ...(videoId
              ? { videoId }
              : ad.videoUrl ? { videoUrl: ad.videoUrl } : {}),
          };
        }),
      })),
    };

    const result = await svc.publishCampaignPlan(plan, (msg) => {
      send({ type: 'progress', message: msg });
    });

    await svc.disconnect();

    await auditLog({
      userId: req.userId!,
      action: 'CAMPAIGN_PUBLISHED',
      resource: 'campaign',
      resourceId: campaign.id,
      details: { metaCampaignId: result.campaignId },
    });

    send({ type: 'done', result });
    res.end();
  } catch (err) {
    if (err instanceof PublishValidationError) {
      send({ type: 'error', errors: err.errors, warnings: err.warnings });
    } else {
      send({ type: 'error', message: String(err) });
    }
    res.end();
  }
});

// ─── Operações na conta ───────────────────────────────────────────────────────

router.patch('/campaigns/:id/status', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['ACTIVE', 'PAUSED'].includes(status)) {
    res.status(400).json({ error: 'Status inválido. Use ACTIVE ou PAUSED.' });
    return;
  }

  const campaign = await prisma.campaign.findFirst({
    where: { metaCampaignId: id, userId: req.userId! },
  });
  if (!campaign) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  const svc = await createMetaMCPService(req.userId!);
  await svc.updateCampaignStatus(id, status);  // corrigido: era updateAdSetStatus
  await svc.disconnect();

  await auditLog({
    userId: req.userId!,
    action: 'CAMPAIGN_STATUS_CHANGED',
    resource: 'campaign',
    resourceId: id,
    details: { status },
  });

  res.json({ success: true, status });
});

router.patch('/campaigns/:id/budget', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { budget } = req.body;

  if (!budget || budget <= 0) {
    res.status(400).json({ error: 'Orçamento inválido' });
    return;
  }

  // Verifica ownership antes de chamar a API do Meta
  const campaign = await prisma.campaign.findFirst({
    where: { metaCampaignId: id, userId: req.userId! },
  });
  if (!campaign) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  const svc = await createMetaMCPService(req.userId!);
  await svc.updateCampaignBudget(id, budget);
  await svc.disconnect();

  await auditLog({
    userId: req.userId!,
    action: 'CAMPAIGN_BUDGET_CHANGED',
    resource: 'campaign',
    resourceId: id,
    details: { budget },
  });

  res.json({ success: true, budget });
});

router.post('/adsets/:id/duplicate', publishRateLimit, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { newBudget } = req.body;

  // Verifica ownership — o adSet deve pertencer a uma campanha do usuário
  const adSet = await prisma.adSet.findFirst({
    where: { metaAdSetId: id, campaign: { userId: req.userId! } },
  });
  if (!adSet) {
    res.status(404).json({ error: 'Conjunto de anúncios não encontrado' });
    return;
  }

  const svc = await createMetaMCPService(req.userId!);
  const result = await svc.duplicateAdSet(id, newBudget);
  await svc.disconnect();

  await auditLog({
    userId: req.userId!,
    action: 'ADSET_DUPLICATED',
    resource: 'adset',
    resourceId: id,
    details: { newBudget, newAdSetId: result.id },
  });

  res.json(result);
});

router.get('/insights/:campaignId', async (req: AuthRequest, res: Response) => {
  const { campaignId } = req.params;
  const { since, until } = req.query as { since?: string; until?: string };

  const today = new Date().toISOString().split('T')[0];
  const dateRange = {
    since: since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    until: until ?? today,
  };

  const svc = await createMetaMCPService(req.userId!);
  const insights = await svc.getCampaignInsights(campaignId, dateRange);
  await svc.disconnect();

  res.json(insights);
});

// ─── Sincronização ────────────────────────────────────────────────────────────

router.post('/sync/now', async (req: AuthRequest, res: Response) => {
  const syncSvc = new SyncService(req.userId!);
  await syncSvc.syncPerformanceMetrics();
  await syncSvc.syncCampaignStatuses();
  res.json({ success: true, syncedAt: new Date() });
});

router.get('/sync/log', async (req: AuthRequest, res: Response) => {
  const logs = await prisma.syncLog.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(logs);
});

router.post('/import', async (req: AuthRequest, res: Response) => {
  const { adAccountId } = req.body;
  if (!adAccountId) {
    res.status(400).json({ error: 'adAccountId é obrigatório' });
    return;
  }

  const syncSvc = new SyncService(req.userId!);
  await syncSvc.importExternalCampaigns(adAccountId);

  await auditLog({
    userId: req.userId!,
    action: 'CAMPAIGNS_IMPORTED',
    resource: 'campaign',
    details: { adAccountId },
  });

  res.json({ success: true });
});

export default router;
