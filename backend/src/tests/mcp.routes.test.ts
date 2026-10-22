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

const { mockListPages, mockGetPageOverview, mockGraphListAdAccounts } = vi.hoisted(() => ({
  mockListPages: vi.fn(),
  mockGetPageOverview: vi.fn(),
  mockGraphListAdAccounts: vi.fn(),
}));
vi.mock('../services/meta.graph.service.js', () => ({
  MetaGraphService: vi.fn().mockImplementation(function () {
    return {
      listPages: mockListPages,
      getPageOverview: mockGetPageOverview,
      listAdAccounts: mockGraphListAdAccounts,
    };
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
  it('revoga a autorização na Meta e desconecta localmente', async () => {
    await prisma.mCPConnection.upsert({
      where: { userId },
      update: { connected: true, metaAccessToken: 'enc:token-meta' },
      create: {
        userId,
        connected: true,
        metaAccessToken: 'enc:token-meta',
        adAccountIds: '[]',
      },
    });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await request(app)
        .delete('/api/mcp/disconnect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, authorizationRevoked: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v23.0/me/permissions',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer token-meta' },
        }),
      );
      await expect(prisma.mCPConnection.findUnique({ where: { userId } }))
        .resolves.toMatchObject({ connected: false });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
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

describe('GET /api/mcp/pages/:pageId/overview', () => {
  it('lê a Página que pertence à conexão', async () => {
    mockGetPageOverview.mockResolvedValueOnce({ id: '456', name: 'Página Teste', posts: [], postsAvailable: true });
    const res = await request(app)
      .get('/api/mcp/pages/456/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Página Teste');
    expect(mockGetPageOverview).toHaveBeenCalledWith('456');
  });

  it('recusa Página que não é desta conexão, sem ir à Meta', async () => {
    mockGetPageOverview.mockClear();
    const res = await request(app)
      .get('/api/mcp/pages/999/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(mockGetPageOverview).not.toHaveBeenCalled();
  });

  it('recusa da Meta vira orientação, sem detalhe interno', async () => {
    mockGetPageOverview.mockRejectedValueOnce(new Error('token secreto inválido'));
    const res = await request(app)
      .get('/api/mcp/pages/456/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/marque esta Página/);
    expect(res.body.error).not.toContain('token secreto');
  });
});

describe('GET /api/mcp/ad-accounts', () => {
  async function linkAccounts(ids: string[]) {
    const data = { connected: true, adAccountIds: JSON.stringify(ids) };
    await prisma.mCPConnection.upsert({
      where: { userId },
      update: data,
      create: { ...data, userId, metaAccessToken: 'enc:token', mcpUrl: 'https://mcp.test.com', mcpProvider: 'pipeboard' },
    });
  }

  it('devolve as contas da conexão com nome, na ordem da conexão', async () => {
    await linkAccounts(['222', 'act_111']);
    mockGraphListAdAccounts.mockResolvedValueOnce([
      { id: 'act_111', name: 'Conta B', currency: 'BRL', timezone: '', status: 1 },
      { id: 'act_222', name: 'Conta A', currency: 'BRL', timezone: '', status: 1 },
      { id: 'act_333', name: 'Conta de outro cliente', currency: 'BRL', timezone: '', status: 1 },
    ]);

    const res = await request(app)
      .get('/api/mcp/ad-accounts')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: string; name: string }) => [a.id, a.name])).toEqual([
      ['222', 'Conta A'],
      ['111', 'Conta B'],
    ]);
  });

  it('Graph fora do ar não esconde as contas — só o nome', async () => {
    await linkAccounts(['222']);
    mockGraphListAdAccounts.mockRejectedValueOnce(new Error('timeout'));

    const res = await request(app)
      .get('/api/mcp/ad-accounts')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '222', name: 'Conta 222', currency: '', status: null }]);
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

// O fluxo é dividido em dois passos de propósito: o cookie de estado precisa
// nascer numa NAVEGAÇÃO ao backend, não na resposta de um fetch cross-origin.
// Setado no fetch, o navegador o descarta como cookie de terceiro e o callback
// falha 100% das vezes com "OAuth inválido" — o loop reportado em 16/09/2026.
// Estes testes travam a divisão para ninguém colapsá-la de volta num passo só.
describe('OAuth Meta em dois passos', () => {
  const originalAppId = process.env.META_APP_ID;
  const originalPublicUrl = process.env.PUBLIC_URL;

  beforeAll(() => {
    process.env.META_APP_ID = '1234567890';
    process.env.PUBLIC_URL = 'https://backend.example.com';
  });

  afterAll(() => {
    if (originalAppId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = originalAppId;
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = originalPublicUrl;
  });

  it('GET /oauth/url aponta para o próprio backend e NÃO seta cookie', async () => {
    const res = await request(app)
      .get('/api/mcp/oauth/url')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin).toBe('https://backend.example.com');
    expect(url.pathname).toBe('/api/mcp/oauth/start');
    expect(url.searchParams.get('state')).toBeTruthy();
    // O cookie aqui seria descartado pelo navegador: esta resposta é de um
    // fetch cross-origin.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('GET /oauth/start seta o cookie e só então manda para a Meta', async () => {
    const urlRes = await request(app)
      .get('/api/mcp/oauth/url')
      .set('Authorization', `Bearer ${token}`);
    const state = new URL(urlRes.body.url).searchParams.get('state')!;

    const res = await request(app).get('/api/mcp/oauth/start').query({ state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('facebook.com');
    expect(res.headers.location).toContain(`state=${encodeURIComponent(state)}`);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('meta_oauth_nonce='))).toBe(true);
  });

  it('GET /oauth/start recusa state não assinado por nós', async () => {
    const res = await request(app)
      .get('/api/mcp/oauth/start')
      .query({ state: 'state-inventado' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error=1');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('callback sem o cookie do nonce recusa — e agora diz o motivo', async () => {
    const urlRes = await request(app)
      .get('/api/mcp/oauth/url')
      .set('Authorization', `Bearer ${token}`);
    const state = new URL(urlRes.body.url).searchParams.get('state')!;

    const res = await request(app)
      .get('/api/mcp/oauth/callback')
      .query({ state, code: 'codigo-qualquer' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error=1');
    expect(res.headers.location).toContain('motivo=');
  });

  it('callback repassa o motivo quando a própria Meta recusa', async () => {
    const res = await request(app)
      .get('/api/mcp/oauth/callback')
      .query({ error: 'access_denied', error_description: 'Permissão negada' });

    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.location)).toContain('access_denied');
  });
});
