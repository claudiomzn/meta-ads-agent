import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import mcpRoutes from '../routes/mcp.routes.js';

// ─── Mock do MetaMCPService ───────────────────────────────────────────────────

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockListAdAccounts = vi.fn().mockResolvedValue([{ id: 'act_123', name: 'Conta Teste' }]);
const mockGetConnectionStatus = vi.fn();
const mockValidatePlan = vi.fn();
const mockPublishCampaignPlan = vi.fn();
const mockUpdateAdSetStatus = vi.fn().mockResolvedValue(undefined);
const mockUpdateCampaignBudget = vi.fn().mockResolvedValue(undefined);
const mockGetCampaignInsights = vi.fn().mockResolvedValue({ spend: 100, roas: 2.5 });

vi.mock('../services/meta.mcp.service.js', () => ({
  MetaMCPService: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
      listAdAccounts: mockListAdAccounts,
      getConnectionStatus: mockGetConnectionStatus,
      validatePlan: mockValidatePlan,
      publishCampaignPlan: mockPublishCampaignPlan,
      updateAdSetStatus: mockUpdateAdSetStatus,
      updateCampaignBudget: mockUpdateCampaignBudget,
      getCampaignInsights: mockGetCampaignInsights,
    };
  }),
  createMetaMCPService: vi.fn().mockImplementation(async function () {
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
      listAdAccounts: mockListAdAccounts,
      getConnectionStatus: mockGetConnectionStatus,
      validatePlan: mockValidatePlan,
      publishCampaignPlan: mockPublishCampaignPlan,
      updateAdSetStatus: mockUpdateAdSetStatus,
      updateCampaignBudget: mockUpdateCampaignBudget,
      getCampaignInsights: mockGetCampaignInsights,
    };
  }),
  PublishValidationError: class PublishValidationError extends Error {
    errors: string[];
    warnings: string[];
    constructor(errors: string[], warnings: string[] = []) {
      super(`Validação falhou: ${errors.join(', ')}`);
      this.name = 'PublishValidationError';
      this.errors = errors;
      this.warnings = warnings;
    }
  },
}));

vi.mock('../services/audit.service.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/crypto.service.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace('enc:', '')),
}));

vi.mock('../services/sync.service.js', () => ({
  SyncService: vi.fn().mockImplementation(function () {
    return {
      syncPerformanceMetrics: vi.fn().mockResolvedValue(undefined),
      syncCampaignStatuses: vi.fn().mockResolvedValue(undefined),
      importExternalCampaigns: vi.fn().mockResolvedValue(undefined),
      handleMetaWebhook: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// ─── Setup do servidor ────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/mcp', mcpRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.mCPConnection.deleteMany({ where: { user: { email: 'mcp@test.com' } } });
  await prisma.user.deleteMany({ where: { email: 'mcp@test.com' } });

  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'MCP Test', email: 'mcp@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.mCPConnection.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'mcp@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockDisconnect.mockResolvedValue(undefined);
  mockListAdAccounts.mockResolvedValue([{ id: 'act_123', name: 'Conta Teste' }]);
  mockUpdateAdSetStatus.mockResolvedValue(undefined);
  mockUpdateCampaignBudget.mockResolvedValue(undefined);
  mockGetCampaignInsights.mockResolvedValue({ spend: 100, roas: 2.5 });
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/mcp/connect', () => {
  it('conecta com dados válidos (provedor Meta — valida token via MCP)', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpUrl: 'https://mcp.pipeboard.co/meta-ads',
        mcpProvider: 'meta',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('meta');
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockListAdAccounts).toHaveBeenCalledOnce();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('conecta via Pipeboard sem testar token (auth embutida na URL)', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mcpUrl: 'https://mcp.pipeboard.co/meta-ads',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('pipeboard');
    // Para Pipeboard a auth já está na URL — não há chamada de teste ao MCP
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('rejeita quando mcpUrl é inválida', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpUrl: 'nao-e-uma-url',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(400);
  });

  it('rejeita quando adAccountIds está vazio', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpUrl: 'https://mcp.pipeboard.co/meta-ads',
        mcpProvider: 'pipeboard',
        adAccountIds: [],
      });

    expect(res.status).toBe(400);
  });

  it('retorna 400 quando conexão MCP falha (provedor Meta)', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Token inválido'));

    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'token-invalido',
        mcpUrl: 'https://mcp.pipeboard.co/meta-ads',
        mcpProvider: 'meta',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Falha ao conectar');
  });

  it('rejeita sem autenticação', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .send({ accessToken: 'x', mcpUrl: 'https://x.com', mcpProvider: 'meta', adAccountIds: ['act_1'] });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/mcp/disconnect', () => {
  it('desconecta com sucesso', async () => {
    const res = await request(app)
      .delete('/api/mcp/disconnect')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/mcp/status', () => {
  it('retorna status da conexão', async () => {
    mockGetConnectionStatus.mockResolvedValueOnce({
      connected: true,
      adAccountIds: ['act_123'],
      provider: 'pipeboard',
    });

    const res = await request(app)
      .get('/api/mcp/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('connected');
  });
});

describe('POST /api/mcp/publish/dry-run', () => {
  it('valida plano sem erros', async () => {
    mockValidatePlan.mockResolvedValueOnce({ valid: true, errors: [], warnings: [] });

    const res = await request(app)
      .post('/api/mcp/publish/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Campanha Teste', adAccountId: 'act_123', adSets: [] });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.errors).toHaveLength(0);
  });

  it('retorna erros de validação', async () => {
    mockValidatePlan.mockResolvedValueOnce({
      valid: false,
      errors: ['Nome obrigatório', 'adAccountId obrigatório'],
      warnings: [],
    });

    const res = await request(app)
      .post('/api/mcp/publish/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors).toHaveLength(2);
  });
});

describe('PATCH /api/mcp/campaigns/:id/status', () => {
  it('rejeita status inválido', async () => {
    const res = await request(app)
      .patch('/api/mcp/campaigns/act_123/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELETED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Status inválido');
  });
});

describe('PATCH /api/mcp/campaigns/:id/budget', () => {
  it('rejeita orçamento zero', async () => {
    const res = await request(app)
      .patch('/api/mcp/campaigns/act_123/budget')
      .set('Authorization', `Bearer ${token}`)
      .send({ budget: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Orçamento inválido');
  });

  it('rejeita orçamento negativo', async () => {
    const res = await request(app)
      .patch('/api/mcp/campaigns/act_123/budget')
      .set('Authorization', `Bearer ${token}`)
      .send({ budget: -100 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/mcp/sync/now', () => {
  it('executa sync com sucesso', async () => {
    const res = await request(app)
      .post('/api/mcp/sync/now')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.syncedAt).toBeDefined();
  });
});

describe('GET /api/mcp/webhook', () => {
  it('verifica webhook com token correto', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'meu-token-secreto';

    const res = await request(app)
      .get('/api/mcp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'meu-token-secreto',
        'hub.challenge': 'desafio123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('desafio123');
  });

  it('rejeita webhook com token errado', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'meu-token-secreto';

    const res = await request(app)
      .get('/api/mcp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-errado',
        'hub.challenge': 'desafio123',
      });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/mcp/import', () => {
  it('rejeita importação sem adAccountId', async () => {
    const res = await request(app)
      .post('/api/mcp/import')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('adAccountId');
  });
});
