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

// Só a ida à Graph API é simulada. `accountsBelongToToken` continua sendo a
// implementação real, para que a regra de propriedade seja de fato exercitada
// pelos testes de rota — antes havia um atalho por NODE_ENV dentro do código de
// produção, e nenhum teste tocava a regra.
// `vi.hoisted` porque a factory do `vi.mock` é elevada ao topo do arquivo e não
// veria uma const declarada aqui embaixo.
const { mockListTokenAdAccountIds } = vi.hoisted(() => ({
  mockListTokenAdAccountIds: vi.fn(),
}));
vi.mock('../lib/metaAdAccounts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/metaAdAccounts.js')>();
  return { ...actual, listTokenAdAccountIds: mockListTokenAdAccountIds };
});

const { mockListPages } = vi.hoisted(() => ({
  mockListPages: vi.fn(),
}));
vi.mock('../services/meta.graph.service.js', () => ({
  MetaGraphService: vi.fn().mockImplementation(function () {
    return { listPages: mockListPages };
  }),
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
  mockListTokenAdAccountIds.mockResolvedValue(new Set(['123']));
  mockListPages.mockResolvedValue([{ id: '456', name: 'Página Teste' }]);
  mockUpdateAdSetStatus.mockResolvedValue(undefined);
  mockUpdateCampaignBudget.mockResolvedValue(undefined);
  mockGetCampaignInsights.mockResolvedValue({ spend: 100, roas: 2.5 });
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/mcp/connect', () => {
  it('rejeita provedor e URL MCP controlados pelo cliente', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpUrl: 'https://mcp.pipeboard.co/meta-ads',
        mcpProvider: 'meta',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('conecta via Pipeboard somente após validar o token pessoal', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
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

  it('ignora mcpUrl enviada pelo cliente e usa somente a configuração do servidor', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpUrl: 'nao-e-uma-url',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(200);
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

  it('não aceita provedor Meta com URL arbitrária', async () => {
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
    expect(res.body.error).toBeTruthy();
  });

  it('rejeita sem autenticação', async () => {
    const res = await request(app)
      .post('/api/mcp/connect')
      .send({ accessToken: 'x', mcpUrl: 'https://x.com', mcpProvider: 'meta', adAccountIds: ['act_1'] });
    expect(res.status).toBe(401);
  });

  // O achado central da auditoria: sem esta checagem, um cliente declarava o
  // id da conta de outro e o token compartilhado do servidor obedecia.
  it('recusa conta de anúncios que o token do usuário não alcança', async () => {
    mockListTokenAdAccountIds.mockResolvedValueOnce(new Set(['123']));

    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_999'],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não pertencem ao token/i);
  });

  it('recusa quando uma das contas do lote não pertence ao usuário', async () => {
    mockListTokenAdAccountIds.mockResolvedValueOnce(new Set(['123']));

    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'EAA...',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_123', 'act_999'],
      });

    expect(res.status).toBe(403);
  });

  it('recusa quando não é possível validar o token na Meta', async () => {
    mockListTokenAdAccountIds.mockRejectedValueOnce(
      new Error('Token Meta inválido ou sem acesso às contas informadas.'),
    );

    const res = await request(app)
      .post('/api/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accessToken: 'token-ruim',
        mcpProvider: 'pipeboard',
        adAccountIds: ['act_123'],
      });

    expect(res.status).toBe(400);
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
    expect(res.body).not.toHaveProperty('mcpUrl');
  });
});

describe('GET /api/mcp/pages', () => {
  it('lista somente as Páginas alcançadas pelo token do usuário', async () => {
    const res = await request(app)
      .get('/api/mcp/pages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '456', name: 'Página Teste' }]);
    expect(mockListPages).toHaveBeenCalledOnce();
  });

  it('não expõe detalhes internos quando a Meta falha', async () => {
    mockListPages.mockRejectedValueOnce(new Error('token secreto inválido'));
    const res = await request(app)
      .get('/api/mcp/pages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error).not.toContain('token secreto');
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

describe('POST /api/mcp/publish/:planId', () => {
  async function createPublishableDraft() {
    await prisma.mCPConnection.upsert({
      where: { userId },
      update: { connected: true, adAccountIds: JSON.stringify(['act_123']), metaAccessToken: 'enc:token' },
      create: {
        userId,
        connected: true,
        adAccountIds: JSON.stringify(['act_123']),
        metaAccessToken: 'enc:token',
        mcpUrl: 'https://test.mcp.example.com',
        mcpProvider: 'pipeboard',
      },
    });
    return prisma.campaign.create({
      data: {
        userId,
        name: 'Rascunho com Página',
        product: 'Produto',
        objective: 'LEAD_GENERATION',
        budget: 1000,
        adSets: {
          create: [{
            name: 'Conjunto 1',
            dailyBudget: 10,
            targeting: '{}',
            optimizationGoal: 'LINK_CLICKS',
            ads: {
              create: [{
                name: 'Anúncio 1',
                headline: 'Título',
                bodyText: 'Texto',
                cta: 'LEARN_MORE',
                destinationUrl: 'https://dominio-ilustrativo.example',
                imageUrl: 'https://storage.example/creative.png',
              }],
            },
          }],
        },
      },
    });
  }

  it('recusa uma Página que o token do usuário não alcança', async () => {
    const campaign = await createPublishableDraft();
    mockListPages.mockResolvedValueOnce([{ id: '456', name: 'Página autorizada' }]);

    const res = await request(app)
      .post(`/api/mcp/publish/${campaign.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adAccountId: 'act_123', pageId: '999' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não pertence/i);
    expect(mockPublishCampaignPlan).not.toHaveBeenCalled();
  });

  it('revalida e encaminha a Página autorizada para a publicação', async () => {
    const campaign = await createPublishableDraft();
    mockListPages.mockResolvedValueOnce([{ id: '456', name: 'Página autorizada' }]);
    mockPublishCampaignPlan.mockResolvedValueOnce({
      success: true,
      campaignId: '1200001',
      status: 'PAUSED_FOR_REVIEW',
      adSetIds: [],
      adIds: [],
      managerUrl: 'https://business.facebook.com/adsmanager',
    });

    const res = await request(app)
      .post(`/api/mcp/publish/${campaign.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        adAccountId: 'act_123',
        pageId: '456',
        destinationUrl: 'https://www.adsgenius.net/',
      });

    expect(res.status).toBe(200);
    expect(mockPublishCampaignPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: '456',
        adSets: [expect.objectContaining({
          ads: [expect.objectContaining({ destinationUrl: 'https://www.adsgenius.net/' })],
        })],
      }),
      expect.any(Function),
    );
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
