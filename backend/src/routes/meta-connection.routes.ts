import { Prisma } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { accountsBelongToToken, listTokenAdAccountIds, normalizeAdAccountId } from '../lib/metaAdAccounts.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js';
import { founderMiddleware } from '../middleware/founder.middleware.js';
import { connectionVerificationRateLimit } from '../middleware/rateLimit.middleware.js';
import { auditLog } from '../services/audit.service.js';
import { encrypt } from '../services/crypto.service.js';
import { sendMail } from '../services/email.service.js';
import { verifyPartnerAccessForRequest } from '../services/metaPartnerVerification.service.js';

const router = Router();
router.use(authMiddleware);

const idSchema = z.string().trim().regex(/^(?:act_)?\d{5,30}$/);
const createSchema = z.object({
  businessName: z.string().trim().max(120).optional(),
  // Opcional: o cliente informa apenas o id da conta de anúncios. Continua
  // aceito para solicitações vindas da versão anterior da tela.
  businessPortfolioId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  adAccountId: idSchema,
});
const statusSchema = z.object({
  status: z.enum(['configuring', 'needs_adjustment', 'cancelled']),
  adminNotes: z.string().trim().max(500).optional(),
  customerMessage: z.string().trim().max(500).optional(),
});
const completeSchema = z.object({
  accessToken: z.string().trim().min(20).max(2_000),
  adminNotes: z.string().trim().max(500).optional(),
});

function publicRequest<T extends {
  id: string;
  businessName: string | null;
  businessPortfolioId: string | null;
  adAccountId: string;
  status: string;
  customerMessage: string | null;
  partnerAccessVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}>(request: T) {
  return {
    id: request.id,
    businessName: request.businessName,
    businessPortfolioId: request.businessPortfolioId,
    adAccountId: request.adAccountId,
    status: request.status,
    customerMessage: request.customerMessage,
    partnerAccessVerifiedAt: request.partnerAccessVerifiedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function notifyAdminOfNewRequest(requestId: string): Promise<void> {
  const target = process.env.ADMIN_ALERT_EMAIL
    ?? process.env.FOUNDER_EMAILS?.split(',').map((email) => email.trim()).find(Boolean);
  if (!target) return;

  const request = await prisma.metaConnectionRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!request) return;
  const client = escapeHtml(request.user.name || request.user.email);
  const email = escapeHtml(request.user.email);
  const adminUrl = `${(process.env.FRONTEND_URL ?? 'https://app.adsgenius.net').replace(/\/$/, '')}/admin`;
  await sendMail({
    to: target,
    subject: `Nova solicitação de conexão Meta — ${request.user.email}`,
    html: `<div style="font-family:Arial,sans-serif">
      <h2>Nova conexão Meta aguardando configuração</h2>
      <p><strong>Cliente:</strong> ${client} (${email})</p>
      ${request.businessPortfolioId
        ? `<p><strong>Portfólio:</strong> ${escapeHtml(request.businessPortfolioId)}</p>`
        : ''}
      <p><strong>Conta de anúncios:</strong> ${escapeHtml(request.adAccountId)}</p>
      <p><a href="${adminUrl}">Abrir fila administrativa</a></p>
    </div>`,
    text: `Nova conexão Meta\nCliente: ${request.user.email}\n`
      + (request.businessPortfolioId ? `Portfólio: ${request.businessPortfolioId}\n` : '')
      + `Conta: ${request.adAccountId}\n${adminUrl}`,
  });
}

function parseAdAccountIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

router.get('/config', (_req: AuthRequest, res: Response) => {
  res.json({
    partnerBusinessId: process.env.META_PARTNER_BUSINESS_ID ?? null,
    verificationConfigured: !!process.env.META_PARTNER_VERIFY_TOKEN,
    slaHours: Math.max(1, Number(process.env.META_CONNECTION_SLA_HOURS ?? 24) || 24),
  });
});

router.get('/request', async (req: AuthRequest, res: Response) => {
  const [request, connection] = await Promise.all([
    prisma.metaConnectionRequest.findFirst({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mCPConnection.findUnique({
      where: { userId: req.userId! },
      select: {
        connected: true,
        adAccountIds: true,
        connectionHealth: true,
        connectionIssue: true,
      },
    }),
  ]);
  res.json({
    request: request ? publicRequest(request) : null,
    connected: connection?.connected === true,
    connectionHealth: connection?.connectionHealth ?? null,
    connectionIssue: connection?.connectionIssue ?? null,
    connectedAdAccountIds: connection?.connected
      ? parseAdAccountIds(connection.adAccountIds)
      : [],
  });
});

router.post('/request', async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Confira o portfólio, a conta e a confirmação de acesso.' });
    return;
  }
  if (!process.env.META_PARTNER_BUSINESS_ID) {
    res.status(503).json({
      error: 'A conexão assistida ainda está sendo configurada pelo AdsGenius.',
      code: 'PARTNER_BUSINESS_NOT_CONFIGURED',
    });
    return;
  }
  const existingConnection = await prisma.mCPConnection.findUnique({
    where: { userId: req.userId! },
    select: { connected: true },
  });
  if (existingConnection?.connected) {
    res.status(409).json({ error: 'Sua conta Meta já está conectada.' });
    return;
  }
  const open = await prisma.metaConnectionRequest.findFirst({
    where: {
      userId: req.userId!,
      status: { in: ['pending', 'configuring', 'needs_adjustment'] },
    },
  });
  if (open) {
    res.status(409).json({ error: 'Você já possui uma solicitação em andamento.', request: publicRequest(open) });
    return;
  }

  try {
    const request = await prisma.metaConnectionRequest.create({
      data: {
        userId: req.userId!,
        businessName: parsed.data.businessName || null,
        businessPortfolioId: parsed.data.businessPortfolioId,
        adAccountId: normalizeAdAccountId(parsed.data.adAccountId),
      },
    });
    await auditLog({
      userId: req.userId!,
      action: 'META_CONNECTION_REQUESTED',
      resource: 'meta_connection_request',
      resourceId: request.id,
    });
    res.status(201).json({ request: publicRequest(request) });
    void notifyAdminOfNewRequest(request.id).catch((error) => {
      console.error('[meta:connection-request] alerta administrativo falhou:', error instanceof Error ? error.message : 'erro');
    });
    void verifyPartnerAccessForRequest(request.id).catch((error) => {
      console.error('[meta:connection-request] verificação inicial falhou:', error instanceof Error ? error.message : 'erro');
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Você já possui uma solicitação em andamento.' });
      return;
    }
    throw error;
  }
});

router.post(
  '/request/:id/verify',
  connectionVerificationRateLimit,
  async (req: AuthRequest, res: Response) => {
    const connectionRequest = await prisma.metaConnectionRequest.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true },
    });
    if (!connectionRequest) {
      res.status(404).json({ error: 'Solicitação não encontrada.' });
      return;
    }
    const result = await verifyPartnerAccessForRequest(connectionRequest.id);
    const updated = await prisma.metaConnectionRequest.findUniqueOrThrow({
      where: { id: connectionRequest.id },
    });
    res.json({ verification: result.state, request: publicRequest(updated) });
  },
);

router.post('/request/:id/cancel', async (req: AuthRequest, res: Response) => {
  const result = await prisma.metaConnectionRequest.updateMany({
    where: {
      id: req.params.id,
      userId: req.userId!,
      status: { in: ['pending', 'needs_adjustment'] },
    },
    data: { status: 'cancelled' },
  });
  if (!result.count) {
    res.status(404).json({ error: 'Solicitação cancelável não encontrada.' });
    return;
  }
  await auditLog({
    userId: req.userId!,
    action: 'META_CONNECTION_REQUEST_CANCELLED',
    resource: 'meta_connection_request',
    resourceId: req.params.id,
  });
  res.json({ ok: true });
});

router.patch('/request/:id', async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Confira o portfólio, a conta e a confirmação de acesso.' });
    return;
  }
  const result = await prisma.metaConnectionRequest.updateMany({
    where: {
      id: req.params.id,
      userId: req.userId!,
      status: 'needs_adjustment',
    },
    data: {
      businessName: parsed.data.businessName || null,
      businessPortfolioId: parsed.data.businessPortfolioId,
      adAccountId: normalizeAdAccountId(parsed.data.adAccountId),
      status: 'pending',
      customerMessage: null,
    },
  });
  if (!result.count) {
    res.status(404).json({ error: 'Solicitação disponível para ajuste não encontrada.' });
    return;
  }
  const request = await prisma.metaConnectionRequest.findUniqueOrThrow({
    where: { id: req.params.id },
  });
  await auditLog({
    userId: req.userId!,
    action: 'META_CONNECTION_REQUEST_RESUBMITTED',
    resource: 'meta_connection_request',
    resourceId: request.id,
  });
  res.json({ request: publicRequest(request) });
});

router.get('/admin/requests', founderMiddleware, async (_req: AuthRequest, res: Response) => {
  const requests = await prisma.metaConnectionRequest.findMany({
    include: { user: { select: { email: true, name: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });
  res.json({
    requests: requests.map((request) => ({
      ...publicRequest(request),
      adminNotes: request.adminNotes,
      user: request.user,
    })),
  });
});

router.post(
  '/admin/requests/:id/verify',
  founderMiddleware,
  connectionVerificationRateLimit,
  async (req: AuthRequest, res: Response) => {
    const connectionRequest = await prisma.metaConnectionRequest.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!connectionRequest) {
      res.status(404).json({ error: 'Solicitação não encontrada.' });
      return;
    }
    const result = await verifyPartnerAccessForRequest(connectionRequest.id);
    const updated = await prisma.metaConnectionRequest.findUniqueOrThrow({
      where: { id: connectionRequest.id },
    });
    res.json({ verification: result.state, request: publicRequest(updated) });
  },
);

router.patch('/admin/requests/:id', founderMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Status ou observação inválida.' });
    return;
  }
  if (parsed.data.status === 'needs_adjustment' && !parsed.data.customerMessage) {
    res.status(400).json({ error: 'Explique ao cliente o ajuste necessário.' });
    return;
  }
  const request = await prisma.metaConnectionRequest.findUnique({ where: { id: req.params.id } });
  if (!request || ['completed', 'cancelled'].includes(request.status)) {
    res.status(404).json({ error: 'Solicitação aberta não encontrada.' });
    return;
  }
  const updated = await prisma.metaConnectionRequest.update({
    where: { id: request.id },
    data: {
      status: parsed.data.status,
      adminNotes: parsed.data.adminNotes ?? request.adminNotes,
      customerMessage: parsed.data.customerMessage ?? request.customerMessage,
    },
  });
  await auditLog({
    userId: req.userId!,
    action: 'META_CONNECTION_REQUEST_UPDATED',
    resource: 'meta_connection_request',
    resourceId: request.id,
    details: { status: parsed.data.status },
  });
  res.json({ request: publicRequest(updated) });
});

router.post('/admin/requests/:id/complete', founderMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Código de acesso ou observação inválida.' });
    return;
  }
  const request = await prisma.metaConnectionRequest.findUnique({ where: { id: req.params.id } });
  if (!request || ['completed', 'cancelled'].includes(request.status)) {
    res.status(404).json({ error: 'Solicitação aberta não encontrada.' });
    return;
  }
  const mcpUrl = process.env.META_MCP_URL;
  if (!mcpUrl) {
    res.status(503).json({ error: 'Integração Meta temporariamente indisponível.' });
    return;
  }

  let reachable: Set<string>;
  try {
    reachable = await listTokenAdAccountIds(parsed.data.accessToken);
  } catch {
    res.status(400).json({ error: 'Não foi possível validar esse código com a Meta.' });
    return;
  }
  if (!accountsBelongToToken([request.adAccountId], reachable)) {
    res.status(403).json({ error: 'Este código não alcança a conta solicitada pelo cliente.' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.metaConnectionRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ['pending', 'configuring', 'needs_adjustment'] },
      },
      data: {
        status: 'completed',
        adminNotes: parsed.data.adminNotes ?? request.adminNotes,
        completedAt: new Date(),
      },
    });
    if (!claimed.count) {
      const conflict = new Error('Esta solicitação já foi concluída ou cancelada.') as Error & {
        status?: number;
      };
      conflict.status = 409;
      throw conflict;
    }
    await tx.mCPConnection.upsert({
      where: { userId: request.userId },
      update: {
        metaAccessToken: encrypt(parsed.data.accessToken),
        mcpUrl,
        mcpProvider: 'pipeboard',
        adAccountIds: JSON.stringify([normalizeAdAccountId(request.adAccountId)]),
        connected: true,
        lastConnectedAt: new Date(),
        connectionHealth: 'healthy',
        connectionIssue: null,
        lastVerifiedAt: new Date(),
      },
      create: {
        userId: request.userId,
        metaAccessToken: encrypt(parsed.data.accessToken),
        mcpUrl,
        mcpProvider: 'pipeboard',
        adAccountIds: JSON.stringify([normalizeAdAccountId(request.adAccountId)]),
        connected: true,
        lastConnectedAt: new Date(),
        connectionHealth: 'healthy',
        connectionIssue: null,
        lastVerifiedAt: new Date(),
      },
    });
  });

  await auditLog({
    userId: req.userId!,
    action: 'META_CONNECTION_REQUEST_COMPLETED',
    resource: 'meta_connection_request',
    resourceId: request.id,
    details: { connectedUserId: request.userId, adAccountId: request.adAccountId },
  });
  res.json({ ok: true });
});

export default router;
