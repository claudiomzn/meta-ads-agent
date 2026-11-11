// Recusa da Meta (HTTP 200 com erro) nas rotas que mudam campanha e nas
// automações: a rota responde 502 com o motivo, e o banco não registra a ação
// (sem metaStatus novo, sem RuleLog, sem cooldown).
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // crypto.service valida a chave na importação; o setup do banco (que
  // definiria isto) não roda nesta suíte.
  process.env.ENCRYPTION_KEY ??= 'test-enc-key-32chars-minimum-ok!';
  process.env.JWT_SECRET ??= 'test-jwt-secret-32chars-minimum!!';
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'u1';
    next();
  },
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    campaign: { findFirst: vi.fn(), update: vi.fn() },
    adSet: { findFirst: vi.fn() },
    automationRule: { findFirst: vi.fn(), update: vi.fn() },
    mCPConnection: { findUnique: vi.fn() },
    ruleLog: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock('../services/audit.service.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/ownership.js', () => ({ targetBelongsToUser: vi.fn().mockResolvedValue(true) }));

const svc = vi.hoisted(() => ({
  updateCampaignStatus: vi.fn(),
  updateCampaignBudget: vi.fn(),
  updateAdSetStatus: vi.fn(),
  updateAdStatus: vi.fn(),
  duplicateAdSet: vi.fn(),
  scaleCampaignBudget: vi.fn(),
  getCampaignInsights: vi.fn(),
  getAdSetInsights: vi.fn(),
  getAdInsights: vi.fn(),
  disconnect: vi.fn(),
}));
// Mock propositalmente SEM `MetaToolResponseError`, como as suítes de banco:
// as rotas precisam reconhecer a recusa pelo nome.
vi.mock('../services/meta.mcp.service.js', () => ({
  createMetaMCPService: vi.fn(async () => svc),
  MetaMCPService: class {},
  PublishValidationError: class extends Error {},
  extractMetaUserError: () => undefined,
}));

import prisma from '../lib/prisma.js';
import mcpRoutes from './mcp.routes.js';
import automationRoutes from './automations.routes.js';

const app = express();
app.use(express.json());
app.use('/api/mcp', mcpRoutes);
app.use('/api/automations', automationRoutes);

const recusa = () =>
  Object.assign(new Error('A Meta rejeitou a alteração da campanha: Você não tem permissão.'), {
    name: 'MetaToolResponseError',
  });

beforeEach(() => {
  vi.clearAllMocks();
  svc.disconnect.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: 'local-1', metaCampaignId: 'mc1' } as never);
  vi.mocked(prisma.mCPConnection.findUnique).mockResolvedValue({ connected: true } as never);
});

describe('PATCH /api/mcp/campaigns/:id/status', () => {
  it('Meta recusou: 502 com o motivo e metaStatus intocado', async () => {
    svc.updateCampaignStatus.mockRejectedValue(recusa());
    const res = await request(app).patch('/api/mcp/campaigns/mc1/status').send({ status: 'PAUSED' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Você não tem permissão');
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    expect(svc.disconnect).toHaveBeenCalled();
  });

  it('Meta aceitou: grava o status novo', async () => {
    svc.updateCampaignStatus.mockResolvedValue(undefined);
    const res = await request(app).patch('/api/mcp/campaigns/mc1/status').send({ status: 'PAUSED' });
    expect(res.status).toBe(200);
    expect(prisma.campaign.update).toHaveBeenCalledWith({ where: { id: 'local-1' }, data: { metaStatus: 'PAUSED' } });
  });
});

describe('PATCH /api/mcp/campaigns/:id/budget', () => {
  it('Meta recusou: 502, não "success"', async () => {
    svc.updateCampaignBudget.mockRejectedValue(recusa());
    const res = await request(app).patch('/api/mcp/campaigns/mc1/budget').send({ budget: 50 });
    expect(res.status).toBe(502);
    expect(res.body.success).toBeUndefined();
  });
});

describe('POST /api/automations/:id/run', () => {
  const regra = (action: string) => ({
    id: 'r1', userId: 'u1', name: 'Regra', targetId: 'mc1', targetType: 'campaign',
    trigger: 'cpl', condition: 'gt', value: 10, window: 7, action,
  });

  it('PAUSE recusado pela Meta: 502, sem RuleLog e sem cooldown', async () => {
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue(regra('PAUSE') as never);
    svc.getCampaignInsights.mockResolvedValue({ cpl: 50 });
    svc.updateCampaignStatus.mockRejectedValue(recusa());

    const res = await request(app).post('/api/automations/r1/run');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Você não tem permissão');
    expect(prisma.ruleLog.create).not.toHaveBeenCalled();
    const updates = vi.mocked(prisma.automationRule.update).mock.calls.map(([a]) => a.data);
    expect(updates.some((d) => 'lastTriggeredAt' in d)).toBe(false);
    expect(svc.disconnect).toHaveBeenCalled();
  });

  it('SCALE_UP que não pôde escalar: executed=false, motivo, sem RuleLog', async () => {
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue(regra('SCALE_UP') as never);
    svc.getCampaignInsights.mockResolvedValue({ cpl: 50 });
    svc.scaleCampaignBudget.mockResolvedValue({ escalado: false, motivo: 'O orçamento não foi alterado.' });

    const res = await request(app).post('/api/automations/r1/run');
    expect(res.status).toBe(200);
    expect(res.body.executed).toBe(false);
    expect(res.body.error).toContain('não foi alterado');
    expect(prisma.ruleLog.create).not.toHaveBeenCalled();
  });
});
