import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// A listagem de contas do token é mockada — o que importa aqui é QUAL conta o
// helper escolhe, não a chamada de rede.
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

const { resolveUserAdAccountId } = await import('../lib/adAccount.js');

const prisma = new PrismaClient();
const USER = 'user-adaccount-test';
const OTHER = 'user-adaccount-other';

async function connect(userId: string, adAccountIds: string[]) {
  // MCPConnection.userId tem FK para User — o usuário precisa existir antes.
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: `${userId}@test.local`, password: 'x', name: userId },
  });
  await prisma.mCPConnection.upsert({
    where: { userId },
    update: { adAccountIds: JSON.stringify(adAccountIds) },
    create: {
      userId,
      metaAccessToken: 'enc:token',
      mcpUrl: 'https://mcp.test.com',
      mcpProvider: 'pipeboard',
      adAccountIds: JSON.stringify(adAccountIds),
      connected: true,
    },
  });
}

beforeAll(async () => {
  await connect(USER, ['1111111111']);      // gravado SEM act_, como o frontend faz
  await connect(OTHER, ['9999999999']);
});

afterAll(async () => {
  await prisma.mCPConnection.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.$disconnect();
});

describe('resolveUserAdAccountId', () => {
  it('devolve a conta DO USUÁRIO, não a primeira que o token enxerga', async () => {
    // Token compartilhado (pipeboard/zapier) enxerga a conta de outro cliente
    // primeiro — o bug antigo retornava accounts[0] = act_9999999999.
    mockGet.mockResolvedValueOnce({
      data: { data: [{ id: 'act_9999999999' }, { id: 'act_1111111111' }] },
    });

    await expect(resolveUserAdAccountId(USER, 'token')).resolves.toBe('act_1111111111');
  });

  it('adiciona o prefixo act_ que o frontend remove ao salvar', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [{ id: 'act_1111111111' }] } });
    const id = await resolveUserAdAccountId(USER, 'token');
    expect(id.startsWith('act_')).toBe(true);
  });

  it('usa a conta do usuário mesmo se a listagem do token falhar', async () => {
    mockGet.mockRejectedValueOnce(new Error('rede'));
    await expect(resolveUserAdAccountId(USER, 'token')).resolves.toBe('act_1111111111');
  });

  it('não cai na conta alheia quando o token não enxerga a do usuário', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [{ id: 'act_9999999999' }] } });
    await expect(resolveUserAdAccountId(USER, 'token')).resolves.toBe('act_1111111111');
  });

  it('falha claro quando não há conta vinculada', async () => {
    await connect(USER, []);
    await expect(resolveUserAdAccountId(USER, 'token')).rejects.toThrow(/Nenhuma conta/);
    await connect(USER, ['1111111111']);
  });
});
