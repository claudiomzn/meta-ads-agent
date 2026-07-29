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
import { SyncService, alertOnConsecutiveFailures } from '../services/sync.service.js';
import { encrypt } from '../services/crypto.service.js';
import { auditLog } from '../services/audit.service.js';
import jwt from 'jsonwebtoken';
import { accountsBelongToToken, listTokenAdAccountIds } from '../lib/metaAdAccounts.js';
import {
  getMetaConnectOptions,
  isManualConnectEnabled,
  isMetaOAuthEnabled,
} from '../lib/metaConnectOptions.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Resolve com segurança um filename derivado de ad.imageUrl/ad.videoUrl (que
// vêm de campos livres em Campaign/AdSet/Ad — o usuário pode setar
// imageUrl/videoUrl arbitrário via /api/campaigns) pra dentro de UPLOAD_DIR.
// path.basename() descarta qualquer "../", e a checagem final garante que o
// path resolvido não escapa da pasta de uploads. Retorna null se inválido.
function safeUploadFilePath(filename: string): string | null {
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(UPLOAD_DIR, safeFilename);
  const resolvedUploadDir = path.resolve(UPLOAD_DIR);
  if (filePath !== resolvedUploadDir && !filePath.startsWith(resolvedUploadDir + path.sep)) {
    return null;
  }
  return filePath;
}

const router = Router();

// Remove interesses com ID inválido (ex: "PLACEHOLDER" gerado pela IA no fluxo
// antigo, ou qualquer ID não-numérico) — o Meta rejeita o conjunto inteiro se
// um interesse não existir. Garante que a publicação não quebre por isso.
function sanitizeTargeting(targeting: Record<string, unknown>): Record<string, unknown> {
  if (!targeting || typeof targeting !== 'object') return targeting;

  const isValidId = (id: unknown) => typeof id === 'string' && /^\d+$/.test(id);
  const cleanInterests = (arr: unknown): unknown[] =>
    Array.isArray(arr) ? arr.filter((i) => i && typeof i === 'object' && isValidId((i as { id?: unknown }).id)) : [];

  const t = { ...targeting };

  // interests no nível raiz
  if ('interests' in t) {
    const kept = cleanInterests(t.interests);
    if (kept.length) t.interests = kept;
    else delete t.interests;
  }

  // interests dentro de flexible_spec
  if (Array.isArray(t.flexible_spec)) {
    const specs = (t.flexible_spec as Array<Record<string, unknown>>)
      .map((spec) => {
        const kept = cleanInterests(spec.interests);
        return kept.length ? { ...spec, interests: kept } : null;
      })
      .filter(Boolean);
    if (specs.length) t.flexible_spec = specs;
    else delete t.flexible_spec;
  }

  return t;
}

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

    // Usa o corpo BRUTO (rawBody, capturado no verify do express.json em
    // index.ts) — re-serializar req.body com JSON.stringify pode divergir do
    // payload original (ordem de chaves, espaçamento) e rejeitar assinaturas
    // legítimas, ou em tese permitir manipulação. timingSafeEqual evita
    // vazar o valor do HMAC esperado por diferença de tempo de comparação.
    const rawBody = (req as AuthRequest & { rawBody?: Buffer }).rawBody;
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', appSecret)
        .update(rawBody ?? Buffer.from(JSON.stringify(req.body)))
        .digest('hex');

    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);
    const valid =
      expectedBuf.length === signatureBuf.length &&
      crypto.timingSafeEqual(expectedBuf, signatureBuf);

    if (!valid) {
      res.status(401).json({ error: 'Assinatura inválida' });
      return;
    }
  }

  res.status(200).json({ received: true });

  const adAccountId = req.body?.entry?.[0]?.id;
  if (adAccountId) {
    // adAccountIds é uma JSON string ('["123","456"]'), então não dá pra
    // comparar no banco. `contains` era SUBSTRING: o id "123" casava dentro de
    // '["1234567"]' e o evento ia parar na conta de outro cliente. Aqui a
    // conferência é feita item a item, com igualdade e ignorando o prefixo
    // act_ (o frontend grava sem ele, o Meta manda com).
    const target = String(adAccountId).replace(/^act_/, '');
    const candidates = await prisma.mCPConnection.findMany({
      where: { adAccountIds: { contains: target } },
    });
    const conn = candidates.find((c) => {
      try {
        const ids: string[] = JSON.parse(c.adAccountIds ?? '[]');
        return ids.some((id) => String(id).replace(/^act_/, '') === target);
      } catch {
        return false;
      }
    });
    if (conn) {
      const syncSvc = new SyncService(conn.userId);
      syncSvc.handleMetaWebhook(req.body).catch(console.error);
    } else {
      console.warn('[mcp:webhook] evento sem conexão correspondente — descartado');
    }
  }
});

// Callback público do OAuth Meta. A identidade fica no state assinado e curto;
// nenhum userId vindo livremente da URL é aceito.
router.get('/oauth/callback', async (req: AuthRequest, res: Response) => {
  const frontend = process.env.FRONTEND_URL ?? 'https://app.adsgenius.net';
  try {
    if (!isMetaOAuthEnabled()) throw new Error('OAuth desativado');
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as {
      purpose?: string;
      userId?: string;
    };
    if (payload.purpose !== 'meta_oauth' || !payload.userId || !code) {
      throw new Error('OAuth inválido');
    }
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const publicUrl = process.env.PUBLIC_URL;
    if (!appId || !appSecret || !publicUrl) throw new Error('OAuth não configurado');
    const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/mcp/oauth/callback`;

    const tokenUrl = new URL('https://graph.facebook.com/v23.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const shortResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
    if (!shortResponse.ok) throw new Error('Falha ao trocar código OAuth');
    const short = await shortResponse.json() as { access_token?: string };
    if (!short.access_token) throw new Error('Token OAuth ausente');

    const longUrl = new URL('https://graph.facebook.com/v23.0/oauth/access_token');
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', appId);
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('fb_exchange_token', short.access_token);
    const longResponse = await fetch(longUrl, { signal: AbortSignal.timeout(10_000) });
    const long = longResponse.ok
      ? await longResponse.json() as { access_token?: string }
      : {};
    const accessToken = long.access_token ?? short.access_token;
    const accounts = [...await listTokenAdAccountIds(accessToken)];
    if (!accounts.length) throw new Error('Nenhuma conta de anúncios encontrada');

    const mcpUrl = process.env.META_MCP_URL;
    if (!mcpUrl) throw new Error('Integração MCP indisponível');
    await prisma.mCPConnection.upsert({
      where: { userId: payload.userId },
      update: {
        metaAccessToken: encrypt(accessToken),
        mcpUrl,
        mcpProvider: 'pipeboard',
        adAccountIds: JSON.stringify(accounts),
        connected: true,
        lastConnectedAt: new Date(),
      },
      create: {
        userId: payload.userId,
        metaAccessToken: encrypt(accessToken),
        mcpUrl,
        mcpProvider: 'pipeboard',
        adAccountIds: JSON.stringify(accounts),
        connected: true,
        lastConnectedAt: new Date(),
      },
    });
    await auditLog({ userId: payload.userId, action: 'META_OAUTH_CONNECT', resource: 'mcp_connection' });
    res.redirect(302, `${frontend.replace(/\/$/, '')}/app/meta/connect?connected=1`);
  } catch (error) {
    console.error('[meta:oauth:callback]', error);
    res.redirect(302, `${frontend.replace(/\/$/, '')}/app/meta/connect?oauth_error=1`);
  }
});

// Todos os endpoints abaixo exigem autenticação
router.use(authMiddleware);

// ─── Conexão ──────────────────────────────────────────────────────────────────

const ConnectSchema = z.object({
  accessToken: z.string().optional().default(''),
  // A URL MCP é exclusivamente do servidor. Aceitar URL do cliente permitiria
  // SSRF e enviaria o token Meta como Bearer para um host controlado.
  mcpProvider: z.enum(['pipeboard', 'zapier']),
  adAccountIds: z.array(z.string().regex(/^(?:act_)?\d+$/)).min(1).max(20),
});

// Diz ao frontend quais caminhos de conexão oferecer, em vez de deixá-lo tentar
// e descobrir pelo erro.
router.get('/connect-options', (_req: AuthRequest, res: Response) => {
  res.json(getMetaConnectOptions());
});

router.get('/oauth/url', (req: AuthRequest, res: Response) => {
  if (!isMetaOAuthEnabled()) {
    res.status(503).json({ error: 'Conexão automática Meta ainda não está disponível.' });
    return;
  }
  const appId = process.env.META_APP_ID;
  const publicUrl = process.env.PUBLIC_URL;
  if (!appId || !publicUrl) {
    res.status(503).json({ error: 'Conexão automática Meta ainda não está configurada.' });
    return;
  }
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/mcp/oauth/callback`;
  const state = jwt.sign(
    { purpose: 'meta_oauth', userId: req.userId! },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' },
  );
  const url = new URL('https://www.facebook.com/v23.0/dialog/oauth');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set(
    'scope',
    [
      'ads_read',
      'ads_management',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_manage_insights',
    ].join(','),
  );
  res.json({ url: url.toString() });
});

router.post('/connect', async (req: AuthRequest, res: Response) => {
  if (!isManualConnectEnabled()) {
    res.status(410).json({
      error: 'A conexão manual foi desativada. Conecte pelo Facebook.',
      code: 'MANUAL_CONNECT_DISABLED',
    });
    return;
  }

  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const messages = Object.entries(fieldErrors)
      .map(([field, errs]) => `${field}: ${(errs as string[]).join(', ')}`)
      .join(' | ');
    res.status(400).json({ error: messages || 'Dados inválidos' });
    return;
  }

  const { accessToken, mcpProvider, adAccountIds } = parsed.data;

  // O token pessoal é obrigatório em todos os provedores: ele é a prova de
  // que as contas declaradas realmente pertencem ao usuário. O segredo MCP
  // compartilhado nunca é usado como prova de ownership.
  if (!accessToken) {
    res.status(400).json({ error: 'Token de acesso Meta é obrigatório.' });
    return;
  }

  const mcpUrl = process.env.META_MCP_URL ?? '';
  if (!mcpUrl) {
    res.status(503).json({ error: 'Integração Meta temporariamente indisponível.' });
    return;
  }

  try {
    const tokenAccounts = await listTokenAdAccountIds(accessToken);
    if (!accountsBelongToToken(adAccountIds, tokenAccounts)) {
      res.status(403).json({ error: 'Uma ou mais contas informadas não pertencem ao token Meta.' });
      return;
    }
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Não foi possível validar o token Meta.',
    });
    return;
  }

  await prisma.mCPConnection.upsert({
    where: { userId: req.userId! },
    update: {
      metaAccessToken: encrypt(accessToken),
      mcpUrl,
      mcpProvider,
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
      lastConnectedAt: new Date(),
    },
    create: {
      userId: req.userId!,
      metaAccessToken: encrypt(accessToken),
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

  // Conta de destino: se o frontend mandar adAccountId no body, valida que
  // ela pertence ao usuário (está entre as contas da MCPConnection) antes de
  // usar — no modelo pipeboard/zapier o token é compartilhado entre todos os
  // clientes, então sem essa checagem um adAccountId arbitrário publicaria
  // na conta de outro cliente. Se não vier no body, usa a conta já associada
  // à campanha local (comportamento anterior).
  const bodyAdAccountId = typeof req.body?.adAccountId === 'string' ? req.body.adAccountId.trim() : '';
  let adAccountId = campaign.metaAdAccountId ?? '';

  if (bodyAdAccountId) {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: req.userId! } });
    let allowedAccountIds: string[] = [];
    try {
      allowedAccountIds = conn ? JSON.parse(conn.adAccountIds) : [];
    } catch {
      allowedAccountIds = [];
    }
    const normalize = (id: string) => id.replace(/^act_/, '');
    const isAllowed = allowedAccountIds.some((id) => normalize(id) === normalize(bodyAdAccountId));
    if (!isAllowed) {
      res.status(403).json({ error: 'Você não tem acesso a essa conta de anúncios.' });
      return;
    }
    adAccountId = bodyAdAccountId;
  }

  if (!adAccountId) {
    res.status(400).json({ error: 'Nenhuma conta de anúncios selecionada.' });
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
          const filePath = safeUploadFilePath(filename);
          if (filePath && fs.existsSync(filePath)) {
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
        if (ad.imageUrl?.startsWith('https://') && !imageHashMap.has(ad.imageUrl)) {
          try {
            send({ type: 'progress', message: 'Enviando imagem armazenada para o Meta...' });
            const uploaded = await svc.uploadCreativeImage(ad.imageUrl, adAccountId);
            if (uploaded.hash) imageHashMap.set(ad.imageUrl, uploaded.hash);
          } catch {
            send({ type: 'progress', message: 'Aviso: falha ao enviar a imagem armazenada.' });
          }
        }
        // Vídeos
        if (ad.videoUrl?.startsWith('/api/media/file/') && !videoIdMap.has(ad.videoUrl)) {
          const filename = ad.videoUrl.replace('/api/media/file/', '');
          const filePath = safeUploadFilePath(filename);
          if (filePath && fs.existsSync(filePath)) {
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
        if (ad.videoUrl?.startsWith('https://') && !videoIdMap.has(ad.videoUrl)) {
          try {
            send({ type: 'progress', message: 'Enviando vídeo armazenado para o Meta...' });
            const uploaded = await svc.uploadCreativeVideo(ad.videoUrl, adAccountId);
            if (uploaded.id) videoIdMap.set(ad.videoUrl, uploaded.id);
          } catch {
            send({ type: 'progress', message: 'Aviso: falha ao enviar o vídeo armazenado.' });
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    const plan = {
      localId: campaign.id,
      // adAccountId já validado acima (body, se veio e pertence ao usuário;
      // senão o já associado à campanha local).
      adAccountId,
      name: campaign.name,
      objective: campaign.objective,
      adSets: campaign.adSets.map((as) => ({
        localId: as.id,
        name: as.name,
        dailyBudget: as.dailyBudget,
        targeting: sanitizeTargeting(JSON.parse(as.targeting)),
        optimizationGoal: as.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        ads: as.ads.map((ad) => {
          const imageHash = ad.imageUrl ? imageHashMap.get(ad.imageUrl) : undefined;
          const videoId   = ad.videoUrl ? videoIdMap.get(ad.videoUrl) : undefined;
          return {
            localId: ad.id,
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
      send({ type: 'error', message: 'Não foi possível publicar a campanha no Meta.' });
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

  // Ownership: campaignId vem do param sem checagem — no modelo de token
  // compartilhado (pipeboard/zapier) isso permitia buscar insights de uma
  // campanha de OUTRO cliente só sabendo o metaCampaignId dela. Busca a
  // campanha local do usuário (aceita id local ou metaCampaignId) e usa
  // sempre o metaCampaignId encontrado — nunca o param cru.
  const campaign = await prisma.campaign.findFirst({
    where: {
      userId: req.userId!,
      OR: [{ id: campaignId }, { metaCampaignId: campaignId }],
    },
  });
  if (!campaign?.metaCampaignId) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const dateRange = {
    since: since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    until: until ?? today,
  };

  const svc = await createMetaMCPService(req.userId!);
  const insights = await svc.getCampaignInsights(campaign.metaCampaignId, dateRange);
  await svc.disconnect();

  res.json(insights);
});

// ─── Saturação de criativo (fadiga de frequência) por conta ──────────────────
// Diferente de /insights/:campaignId (1 campanha), esta lista TODAS as
// campanhas publicadas de uma conta com a frequência atual, pra tela de
// Saturação. Frequência vem em tempo real do Meta (últimos 7 dias) — o campo
// metaFrequency do AdSet no banco só é atualizado no sync horário.
router.get('/saturation/:adAccountId', async (req: AuthRequest, res: Response) => {
  const { adAccountId } = req.params;

  const campaigns = await prisma.campaign.findMany({
    where: {
      userId: req.userId!,
      metaAdAccountId: adAccountId,
      metaCampaignId: { not: null },
    },
  });

  if (campaigns.length === 0) {
    res.json({ data: [] });
    return;
  }

  const dateRange = {
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    until: new Date().toISOString().split('T')[0],
  };

  const svc = await createMetaMCPService(req.userId!);
  const results = await Promise.all(
    campaigns.map(async (c) => {
      try {
        const insights = await svc.getCampaignInsights(c.metaCampaignId!, dateRange);
        return {
          id: c.id,
          campaign_id: c.metaCampaignId,
          campaign_name: c.name,
          status: c.metaStatus,
          budget: c.budget,
          frequency: insights.frequency ?? 0,
          reach: insights.reach ?? 0,
          impressions: insights.impressions ?? c.metaImpressions ?? 0,
          spend: insights.spend ?? c.metaSpend ?? 0,
        };
      } catch (err) {
        console.error(`[Saturation] Erro ao buscar insights de ${c.metaCampaignId}:`, err);
        return null;
      }
    }),
  );
  await svc.disconnect();

  res.json({ data: results.filter(Boolean) });
});

// ─── Sincronização ────────────────────────────────────────────────────────────

router.post('/sync/now', async (req: AuthRequest, res: Response) => {
  const syncSvc = new SyncService(req.userId!);
  await syncSvc.syncPerformanceMetrics();
  await syncSvc.syncCampaignStatuses();
  res.json({ success: true, syncedAt: new Date() });
});

// Apenas para ambiente de teste — simula 2 falhas consecutivas de sync e dispara o alerta
router.post('/sync/test-alert', async (req: AuthRequest, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const userId = req.userId!;
  const type = 'metrics';
  const details = 'Erro simulado para teste de alerta';

  await prisma.syncLog.createMany({
    data: [
      { userId, type, status: 'error', details },
      { userId, type, status: 'error', details },
    ],
  });

  await alertOnConsecutiveFailures(userId, type, details);

  res.json({ success: true, message: 'Alerta de teste disparado (verifique o email/log)' });
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

  // Modelo pipeboard/zapier: token de servidor compartilhado — sem essa
  // checagem, importExternalCampaigns(adAccountId) importaria pro dashboard
  // do requisitante campanhas de QUALQUER conta acessível pelo token,
  // inclusive contas de outros clientes.
  const conn = await prisma.mCPConnection.findUnique({ where: { userId: req.userId! } });
  if (!conn) {
    res.status(403).json({ error: 'Você não tem acesso a essa conta.' });
    return;
  }
  let allowedAccountIds: string[] = [];
  try {
    allowedAccountIds = JSON.parse(conn.adAccountIds);
  } catch {
    allowedAccountIds = [];
  }
  const normalize = (id: string) => id.replace(/^act_/, '');
  const isAllowed = allowedAccountIds.some((id) => normalize(id) === normalize(adAccountId));
  if (!isAllowed) {
    res.status(403).json({ error: 'Você não tem acesso a essa conta.' });
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
