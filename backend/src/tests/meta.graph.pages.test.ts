import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// As chamadas à Graph são mockadas por caminho — o que importa aqui é COMO as
// duas fontes de Página se combinam, não a rede.
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));
vi.mock('../services/crypto.service.js', () => ({
  decrypt: () => 'token-decifrado',
  encrypt: (v: string) => v,
}));

const { MetaGraphService } = await import('../services/meta.graph.service.js');

const prisma = new PrismaClient();
const USER = 'user-graph-pages-test';
const PAGE = { id: '359271461327882', name: 'Amazon planos de Saúde' };

async function connect(adAccountIds: string[]) {
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, email: `${USER}@test.local`, password: 'x', name: USER },
  });
  await prisma.mCPConnection.upsert({
    where: { userId: USER },
    update: { adAccountIds: JSON.stringify(adAccountIds) },
    create: {
      userId: USER,
      metaAccessToken: 'enc:token',
      mcpUrl: 'https://mcp.test.com',
      mcpProvider: 'meta',
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
    },
  });
}

// Responde por caminho da Graph: me/accounts e cada act_/promote_pages.
function routeGraph(routes: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    const match = Object.keys(routes).find((path) => url.endsWith(path));
    if (!match) throw new Error(`caminho inesperado: ${url}`);
    const value = routes[match];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve({ data: value });
  });
}

beforeAll(async () => {
  await connect(['1111111111', '2222222222']); // gravadas SEM act_, como o frontend faz
});

afterAll(async () => {
  await prisma.mCPConnection.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockGet.mockReset();
});

describe('MetaGraphService.listPages', () => {
  it('acha a Página de portfólio que me/accounts esconde', async () => {
    // O bloqueio real: com os 4 escopos aprovados, me/accounts volta vazio.
    routeGraph({
      'me/accounts': { data: [] },
      'act_1111111111/promote_pages': { data: [PAGE] },
      'act_2222222222/promote_pages': { data: [] },
    });

    await expect(new MetaGraphService(USER).listPages()).resolves.toEqual([PAGE]);
  });

  it('não repete a Página que aparece nas duas fontes, e preserva o Instagram', async () => {
    routeGraph({
      'me/accounts': { data: [{ ...PAGE, instagram_business_account: { id: '77' } }] },
      'act_1111111111/promote_pages': { data: [PAGE] },
      'act_2222222222/promote_pages': { data: [PAGE] },
    });

    await expect(new MetaGraphService(USER).listPages()).resolves.toEqual([
      { ...PAGE, instagramBusinessAccountId: '77' },
    ]);
  });

  it('uma conta sem acesso não zera as Páginas das outras', async () => {
    routeGraph({
      'me/accounts': { data: [] },
      'act_1111111111/promote_pages': new Error('(#200) permissão negada'),
      'act_2222222222/promote_pages': { data: [PAGE] },
    });

    await expect(new MetaGraphService(USER).listPages()).resolves.toEqual([PAGE]);
  });

  it('falha em me/accounts continua subindo — ali significa renovar a conexão', async () => {
    routeGraph({
      'me/accounts': new Error('Error validating access token'),
      'act_1111111111/promote_pages': { data: [PAGE] },
      'act_2222222222/promote_pages': { data: [] },
    });

    await expect(new MetaGraphService(USER).listPages()).rejects.toThrow(/access token/);
  });

  it('sem conta vinculada, responde só com me/accounts', async () => {
    await connect([]);
    routeGraph({ 'me/accounts': { data: [PAGE] } });

    await expect(new MetaGraphService(USER).listPages()).resolves.toEqual([PAGE]);
    await connect(['1111111111', '2222222222']);
  });
});
