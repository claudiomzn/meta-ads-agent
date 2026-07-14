import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import automationRoutes from '../routes/automations.routes.js';

// ─── Mock do MetaMCPService ───────────────────────────────────────────────────

const mockGetCampaignInsights = vi.fn().mockResolvedValue({ spend: 200, roas: 1.5, cpc: 2.0 });
const mockGetAdSetInsights = vi.fn().mockResolvedValue({ spend: 100, cpl: 5.0 });
const mockGetAdInsights = vi.fn().mockResolvedValue({ spend: 50, ctr: 0.03 });
const mockUpdateAdSetStatus = vi.fn().mockResolvedValue(undefined);
const mockUpdateAdStatus = vi.fn().mockResolvedValue(undefined);
const mockUpdateCampaignStatus = vi.fn().mockResolvedValue(undefined);
const mockUpdateCampaignBudget = vi.fn().mockResolvedValue(undefined);
const mockScaleCampaignBudget = vi.fn().mockResolvedValue(120);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/meta.mcp.service.js', () => ({
  createMetaMCPService: vi.fn().mockImplementation(() => ({
    getCampaignInsights: mockGetCampaignInsights,
    getAdSetInsights: mockGetAdSetInsights,
    getAdInsights: mockGetAdInsights,
    updateAdSetStatus: mockUpdateAdSetStatus,
    updateAdStatus: mockUpdateAdStatus,
    updateCampaignStatus: mockUpdateCampaignStatus,
    updateCampaignBudget: mockUpdateCampaignBudget,
    scaleCampaignBudget: mockScaleCampaignBudget,
    disconnect: mockDisconnect,
  })),
}));

vi.mock('../services/audit.service.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/automations', automationRoutes);

let token: string;
let userId: string;

const validRule = {
  name: 'Pausar campanha com ROAS baixo',
  targetId: 'act_123',
  targetType: 'campaign',
  trigger: 'roas',
  condition: 'lt',
  value: 1.0,
  window: 7,
  action: 'PAUSE',
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'auto@test.com' } });

  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Auto Test', email: 'auto@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;

  // Regras de automação agora exigem ownership do targetId (proteção IDOR) —
  // cria uma campanha local pertencente a este usuário cujo metaCampaignId
  // é o mesmo usado em `validRule.targetId` ('act_123').
  await prisma.campaign.create({
    data: {
      userId,
      name: 'Campanha de teste',
      product: 'produto',
      objective: 'LEADS',
      budget: 100,
      metaCampaignId: 'act_123',
    },
  });
});

afterAll(async () => {
  await prisma.automationRule.deleteMany({ where: { userId } });
  await prisma.campaign.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'auto@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCampaignInsights.mockResolvedValue({ spend: 200, roas: 1.5, cpc: 2.0 });
  mockGetAdSetInsights.mockResolvedValue({ spend: 100, cpl: 5.0 });
  mockGetAdInsights.mockResolvedValue({ spend: 50, ctr: 0.03 });
  mockUpdateAdSetStatus.mockResolvedValue(undefined);
  mockUpdateAdStatus.mockResolvedValue(undefined);
  mockUpdateCampaignStatus.mockResolvedValue(undefined);
  mockUpdateCampaignBudget.mockResolvedValue(undefined);
  mockScaleCampaignBudget.mockResolvedValue(120);
  mockDisconnect.mockResolvedValue(undefined);
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('GET /api/automations', () => {
  it('retorna lista vazia para novo usuário', async () => {
    const res = await request(app)
      .get('/api/automations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejeita sem autenticação', async () => {
    const res = await request(app).get('/api/automations');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/automations', () => {
  it('cria regra com dados válidos', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send(validRule);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(validRule.name);
    expect(res.body.active).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  it('rejeita sem campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Regra incompleta' });

    expect(res.status).toBe(400);
  });

  it('rejeita trigger inválido', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, trigger: 'revenue' });

    expect(res.status).toBe(400);
  });

  it('rejeita action inválida', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, action: 'DELETE' });

    expect(res.status).toBe(400);
  });

  it('rejeita window acima de 90 dias', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, window: 91 });

    expect(res.status).toBe(400);
  });

  it('rejeita targetId que não pertence ao usuário (IDOR)', async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, targetId: 'act_de_outro_cliente' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/automations/:id/toggle', () => {
  let ruleId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, name: 'Regra para toggle' });
    ruleId = res.body.id;
  });

  it('alterna estado ativo/inativo', async () => {
    const res = await request(app)
      .patch(`/api/automations/${ruleId}/toggle`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);

    const res2 = await request(app)
      .patch(`/api/automations/${ruleId}/toggle`)
      .set('Authorization', `Bearer ${token}`);

    expect(res2.body.active).toBe(true);
  });

  it('retorna 404 para id inexistente', async () => {
    const res = await request(app)
      .patch('/api/automations/id-nao-existe/toggle')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/automations/:id/run', () => {
  let ruleId: string;

  beforeAll(async () => {
    // Cria regra e conexão MCP para o usuário
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, name: 'Regra para execução manual' });
    ruleId = res.body.id;

    await prisma.mCPConnection.upsert({
      where: { userId },
      update: { connected: true },
      create: {
        userId,
        metaAccessToken: 'enc:token',
        mcpUrl: 'https://mcp.test.com',
        mcpProvider: 'pipeboard',
        adAccountIds: JSON.stringify(['act_123']),
        connected: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.mCPConnection.deleteMany({ where: { userId } });
  });

  it('executa regra e retorna resultado quando condição não é atendida', async () => {
    // roas = 1.5, condição: roas < 1.0 → não atendida
    mockGetCampaignInsights.mockResolvedValueOnce({ spend: 200, roas: 1.5 });

    const res = await request(app)
      .post(`/api/automations/${ruleId}/run`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.conditionMet).toBe(false);
    expect(res.body.executed).toBe(false);
    expect(res.body.metricValue).toBe(1.5);
    expect(res.body.threshold).toBe(1.0);
  });

  it('executa ação PAUSE quando condição é atendida', async () => {
    // roas = 0.5, condição: roas < 1.0 → atendida → PAUSE pausa a CAMPANHA de
    // verdade (antes, targetType=campaign era silenciosamente ignorado)
    mockGetCampaignInsights.mockResolvedValueOnce({ spend: 200, roas: 0.5 });

    const res = await request(app)
      .post(`/api/automations/${ruleId}/run`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.conditionMet).toBe(true);
    expect(res.body.executed).toBe(true);
    expect(res.body.metricValue).toBe(0.5);
    expect(mockUpdateCampaignStatus).toHaveBeenCalledWith('act_123', 'PAUSED');
  });

  it('retorna 400 quando MCP não está conectado', async () => {
    await prisma.mCPConnection.updateMany({
      where: { userId },
      data: { connected: false },
    });

    const res = await request(app)
      .post(`/api/automations/${ruleId}/run`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('não conectado');

    // Restaura
    await prisma.mCPConnection.updateMany({
      where: { userId },
      data: { connected: true },
    });
  });

  it('retorna 404 para regra inexistente', async () => {
    const res = await request(app)
      .post('/api/automations/regra-nao-existe/run')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/automations/:id', () => {
  let ruleId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, name: 'Regra para deletar' });
    ruleId = res.body.id;
  });

  it('deleta regra existente', async () => {
    const del = await request(app)
      .delete(`/api/automations/${ruleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(204);

    const get = await request(app)
      .get('/api/automations')
      .set('Authorization', `Bearer ${token}`);

    expect(get.body.find((r: { id: string }) => r.id === ruleId)).toBeUndefined();
  });

  it('retorna 404 para id inexistente', async () => {
    const res = await request(app)
      .delete('/api/automations/id-nao-existe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/automations/:id/logs', () => {
  let ruleId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, name: 'Regra para logs' });
    ruleId = res.body.id;
  });

  it('retorna logs vazios para nova regra', async () => {
    const res = await request(app)
      .get(`/api/automations/${ruleId}/logs`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retorna 404 para regra inexistente', async () => {
    const res = await request(app)
      .get('/api/automations/id-nao-existe/logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('Isolamento entre usuários', () => {
  let otherToken: string;
  let ruleId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'other-auto@test.com' } });
    const other = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other Auto', email: 'other-auto@test.com', password: 'senha123' });
    otherToken = other.body.token;

    const rule = await request(app)
      .post('/api/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validRule, name: 'Regra privada' });
    ruleId = rule.body.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'other-auto@test.com' } });
  });

  it('usuário não vê regras de outro usuário', async () => {
    const res = await request(app)
      .get('/api/automations')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((r: { id: string }) => r.id === ruleId)).toBeUndefined();
  });

  it('usuário não deleta regra de outro usuário', async () => {
    const res = await request(app)
      .delete(`/api/automations/${ruleId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });

  it('usuário não alterna regra de outro usuário', async () => {
    const res = await request(app)
      .patch(`/api/automations/${ruleId}/toggle`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });
});
