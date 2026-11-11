// Rotas de IA que respondem 200 quando a IA falhou não podem cobrar crédito.
// Roda com NODE_ENV=production para o `aiBudget`/`runWithAiBudget` falarem
// com o ledger (fetch mockado) — em `test` os dois pulam a cobrança e o
// teste ficaria cego. Também cobre a execução de proposta recusada pela Meta.
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'backend-user';
    next();
  },
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    campaign: { findMany: vi.fn() },
    copy: { findMany: vi.fn() },
    audience: { findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    chatMessage: { createMany: vi.fn() },
    agentProposal: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../services/email.service.js', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/audit.service.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }));

const ia = vi.hoisted(() => ({
  scoreCopy: vi.fn(),
  generateCampaignPlan: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  executeProposal: vi.fn(),
}));

// `new AIService()` e `new Anthropic()` no código de produção: o mock
// precisa ser CLASSE de verdade — `vi.fn().mockImplementation` não é
// construtível e o TypeError seria engolido pelo try/catch da rota.
vi.mock('../services/ai.service.js', () => ({
  AIService: class {
    scoreCopy = ia.scoreCopy;
    generateCampaignPlan = ia.generateCampaignPlan;
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: ia.anthropicCreate, stream: ia.anthropicStream };
  },
}));
vi.mock('../services/agentProposals.service.js', () => ({ executeProposal: ia.executeProposal }));

import prisma from '../lib/prisma.js';
import agentRoutes from './agent.routes.js';
import copiesRoutes from './copies.routes.js';
import audiencesRoutes from './audiences.routes.js';

const app = express();
app.use(express.json());
app.use('/api/agent', agentRoutes);
app.use('/api/copies', copiesRoutes);
app.use('/api/audiences', audiencesRoutes);

const CHAVES_ENV = ['NODE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const originalEnv = Object.fromEntries(CHAVES_ENV.map((k) => [k, process.env[k]]));
let fetchMock: ReturnType<typeof vi.fn>;
const rpcs = () => fetchMock.mock.calls.map(([url]) => String(url).split('/rpc/')[1]);

const campanhaComGasto = {
  id: 'c1', name: 'Leads', metaCampaignId: 'mc1', metaStatus: 'ACTIVE', metaSpend: 300,
  metaRoas: 0, metaCpl: 20, metaCpc: 1, metaImpressions: 1000, metaClicks: 30, adSets: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://supabase.example.com';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    supabaseUserId: '550e8400-e29b-41d4-a716-446655440000',
  } as never);
  vi.mocked(prisma.copy.findMany).mockResolvedValue([]);
  vi.mocked(prisma.audience.findMany).mockResolvedValue([]);
  vi.mocked(prisma.ad.findMany).mockResolvedValue([]);
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('reserve_ai_usage') ? { allowed: true, reservation_id: 'res-1' } : { send: false },
  }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of CHAVES_ENV) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('crédito de IA só quando a IA entregou', () => {
  it('POST /copies/score com a IA fora: 200 com score neutro, reserva LIBERADA', async () => {
    ia.scoreCopy.mockRejectedValue(new Error('Anthropic indisponível'));
    const res = await request(app).post('/api/copies/score').send({ headline: 'h', body: 'b', cta: 'c' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(rpcs()).toContain('release_ai_usage'));
    expect(rpcs()).not.toContain('settle_ai_usage');
  });

  it('POST /copies/score com a IA respondendo: liquida', async () => {
    ia.scoreCopy.mockResolvedValue({ score: 80, strengths: [], issues: [], suggestion: '' });
    await request(app).post('/api/copies/score').send({ headline: 'h', body: 'b', cta: 'c' }).expect(200);
    await vi.waitFor(() => expect(rpcs()).toContain('settle_ai_usage'));
  });

  it('POST /audiences/suggest com a IA fora: interesses fixos, reserva LIBERADA', async () => {
    ia.generateCampaignPlan.mockRejectedValue(new Error('Anthropic indisponível'));
    const res = await request(app).post('/api/audiences/suggest').send({ product: 'plano de saúde' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(rpcs()).toContain('release_ai_usage'));
    expect(rpcs()).not.toContain('settle_ai_usage');
  });

  it('GET /agent/daily-actions sem campanha: nem reserva crédito', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    const res = await request(app).get('/api/agent/daily-actions');
    expect(res.status).toBe(200);
    expect(res.body.actions.length).toBeGreaterThan(0);
    // Dá tempo para um `finish` assíncrono aparecer, se existisse.
    await new Promise((r) => setTimeout(r, 30));
    expect(rpcs()).not.toContain('settle_ai_usage');
    expect(rpcs()).not.toContain('reserve_ai_usage');
  });

  it('GET /agent/daily-actions com a IA fora: fallback e reserva LIBERADA', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([campanhaComGasto] as never);
    ia.anthropicCreate.mockRejectedValue(new Error('Anthropic indisponível'));
    const res = await request(app).get('/api/agent/daily-actions');
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(rpcs()).toContain('release_ai_usage'));
    expect(rpcs()).not.toContain('settle_ai_usage');
  });

  it('POST /agent/chat com erro no streaming (SSE 200): reserva LIBERADA', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    ia.anthropicStream.mockRejectedValue(new Error('Anthropic indisponível'));
    const res = await request(app).post('/api/agent/chat').send({ message: 'oi', history: [] });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"error"');
    await vi.waitFor(() => expect(rpcs()).toContain('release_ai_usage'));
    expect(rpcs()).not.toContain('settle_ai_usage');
  });
});

describe('ROAS não julga conta de lead — fallback de alertas', () => {
  it('GET /agent/proactive-alerts com a IA fora não oferece "Pausar" campanha de lead', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([campanhaComGasto] as never);
    ia.anthropicCreate.mockRejectedValue(new Error('Anthropic indisponível'));
    const res = await request(app).get('/api/agent/proactive-alerts');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Pausar campanha');
  });

  it('o prompt dos alertas manda a IA não julgar lead por ROAS', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([campanhaComGasto] as never);
    ia.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"alerts":[]}' }] });
    await request(app).get('/api/agent/proactive-alerts').expect(200);
    const prompt = String(ia.anthropicCreate.mock.calls[0][0].messages[0].content);
    expect(prompt).toContain('NÃO é prejuízo');
    expect(prompt).not.toMatch(/"roas": 0\b/);
  });
});

describe('POST /agent/proposals/:id/decide — Meta recusou', () => {
  it('marca failed com o motivo da Meta e responde 502', async () => {
    vi.mocked(prisma.agentProposal.findFirst).mockResolvedValue({
      id: 'p1', userId: 'backend-user', status: 'pending', type: 'pause_low_roas', payload: '{}',
    } as never);
    ia.executeProposal.mockRejectedValue(
      Object.assign(new Error('A Meta rejeitou a alteração da campanha: sem permissão'), { name: 'MetaToolResponseError' }),
    );
    const res = await request(app).post('/api/agent/proposals/p1/decide').send({ decision: 'approve' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('sem permissão');
    const updates = vi.mocked(prisma.agentProposal.update).mock.calls.map(([a]) => a.data.status);
    expect(updates).toContain('failed');
    expect(updates).not.toContain('executed');
  });
});

describe('GET /agent/health-score — ROAS fora da nota de conta de lead', () => {
  it('campanha de lead saudável não perde 25 pontos por ROAS 0', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { ...campanhaComGasto, metaImpressions: 1000, metaClicks: 20, metaCpl: 15,
        adSets: [{ metaFrequency: 1.5 }, { metaFrequency: 2 }, { metaFrequency: 1 }] },
      { ...campanhaComGasto, id: 'c2', adSets: [] },
    ] as never);
    const res = await request(app).get('/api/agent/health-score');
    expect(res.status).toBe(200);
    expect(res.body.breakdown.map((b: { label: string }) => b.label)).not.toContain('ROAS médio');
    // 20 (CTR 2%) + 20 (freq.) + 15 (2 ativas) + 10 (3 conjuntos) + 10 (CPL) = 75 de 75 → 100.
    expect(res.body.score).toBe(100);
    expect(res.body.status).toBe('saudavel');
  });
});
