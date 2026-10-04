import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

// Rede da Meta: só o axios.get é falso. Prisma e criptografia rodam de verdade.
const mockGet = vi.fn();
vi.mock('axios', async (orig) => {
  const real = (await orig()) as { default: Record<string, unknown> };
  return { default: { ...real.default, get: (...a: unknown[]) => mockGet(...a) } };
});

process.env.DATABASE_URL = 'postgresql://postgres:test@localhost:5433/metaads_test';
process.env.JWT_SECRET = 'test-jwt-secret-32chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-enc-key-32chars-minimum-ok!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_APP_SECRET = 'test-app-secret';
execSync('npx prisma db push --force-reset', { stdio: 'ignore' });

const { default: authRoutes } = await import('../routes/auth.routes.js');
const { default: whatsappRoutes } = await import('../routes/whatsapp.routes.js');
const { resolverCampanhaDoAnuncio } = await import('../services/whatsapp/origem.meta.js');
const { encrypt } = await import('../services/crypto.service.js');

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;
const TOKEN_META = 'tok_meta_SEGREDO';

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register').send({ name: 'Funil', email: 'funil@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
  await prisma.mCPConnection.create({
    data: { userId, metaAccessToken: encrypt(TOKEN_META), adAccountIds: '[]', connected: true },
  });
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'funil@test.com' } });
  await prisma.$disconnect();
});

// Reiniciar E dar uma resposta padrão: no vitest 4, rejeitar um mock que só foi
// reiniciado reprova o teste mesmo quando o código trata o erro (falso negativo
// que custou uma investigação em 01/10/2026). Mesmo padrão de capi.purchase.test.
beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({ data: {} });
});

describe('resolverCampanhaDoAnuncio', () => {
  it('⭐ pergunta à Meta a campanha do anúncio e devolve o ID', async () => {
    mockGet.mockResolvedValue({ data: { campaign_id: '120210000000777', id: '120210000000555' } });
    expect(await resolverCampanhaDoAnuncio(userId, '120210000000555')).toBe('120210000000777');
    expect(mockGet.mock.calls[0][0]).toContain('/120210000000555');
    expect(mockGet.mock.calls[0][1]).toMatchObject({ params: { fields: 'campaign_id' } });
  });

  it('ID de anúncio que não é número nem chega a virar URL', async () => {
    expect(await resolverCampanhaDoAnuncio(userId, '1/../me')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('resposta sem campaign_id numérico → null (não grava o que não conferiu)', async () => {
    mockGet.mockResolvedValue({ data: { error: { message: 'x' } } });
    expect(await resolverCampanhaDoAnuncio(userId, '120210000000555')).toBeNull();
  });

  it('⭐ erro da Meta → null, e o log NUNCA leva o access_token', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = Object.assign(new Error(`Request failed ?access_token=${TOKEN_META}`), {
      isAxiosError: true, response: { status: 400, data: { error: { message: 'Unsupported get request' } } },
      config: { params: { access_token: TOKEN_META } },
    });
    mockGet.mockRejectedValue(err);
    expect(await resolverCampanhaDoAnuncio(userId, '120210000000555')).toBeNull();
    expect(JSON.stringify(aviso.mock.calls)).not.toContain(TOKEN_META);
    aviso.mockRestore();
  });
});

describe('GET /api/whatsapp/funil-por-campanha', () => {
  it('⭐ conta leads e QUENTES por canal e campanha, no período', async () => {
    const mk = (n: number, origemCampanhaId: string | null, label: string | null, createdAt = new Date()) =>
      prisma.whatsappConversation.create({
        data: { userId, leadPhone: `55119000300${n}`, origemCanal: 'google', origemCampanhaId, label, createdAt },
      });
    await mk(1, '111111', 'QUENTE');
    await mk(2, '111111', 'FRIO');
    await mk(3, '222222', 'QUENTE');
    await mk(4, '111111', 'QUENTE', new Date('2025-01-01T12:00:00Z')); // fora do período

    const res = await request(app).get('/api/whatsapp/funil-por-campanha').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.campanhas).toEqual([
      { canal: 'google', campanhaId: '111111', leads: 2, quentes: 1 },
      { canal: 'google', campanhaId: '222222', leads: 1, quentes: 1 },
    ]);
  });

  it('período inválido → 400', async () => {
    const res = await request(app).get('/api/whatsapp/funil-por-campanha?desde=ontem').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('sem login → 401', async () => {
    expect((await request(app).get('/api/whatsapp/funil-por-campanha')).status).toBe(401);
  });
});

// Venda → lead (04/10/2026): o app manda o WhatsApp do comprador e recebe de
// qual campanha veio a conversa, para pré-selecionar a campanha da venda.
describe('GET /api/whatsapp/origem-do-telefone', () => {
  const buscar = (telefone: string) =>
    request(app).get(`/api/whatsapp/origem-do-telefone?telefone=${encodeURIComponent(telefone)}`).set('Authorization', `Bearer ${token}`);

  it('⭐ acha a conversa pelo número digitado de qualquer jeito, inclusive sem o 9º dígito', async () => {
    // WhatsApp antigo grava o número SEM o 9: 5592 + 8 dígitos.
    await prisma.whatsappConversation.create({
      data: { userId, leadPhone: '559281234567', origemCanal: 'google', origemCampanhaId: '21345678901', origemRef: 'HAP-G', label: 'QUENTE' },
    });
    for (const digitado of ['(92) 98123-4567', '92981234567', '+55 92 98123-4567']) {
      const res = await buscar(digitado);
      expect(res.status, digitado).toBe(200);
      expect(res.body.origem, digitado).toMatchObject({ canal: 'google', campanhaId: '21345678901', ref: 'HAP-G', rotulo: 'QUENTE' });
    }
  });

  it('⭐ mesmo final em OUTRO DDD não é a mesma pessoa', async () => {
    const res = await buscar('(11) 98123-4567');
    expect(res.body.origem).toBeNull();
  });

  it('conversa sem origem (antes da medição) devolve null — "não sei" não vira "sem campanha"', async () => {
    await prisma.whatsappConversation.create({ data: { userId, leadPhone: '5592977776666', label: 'FRIO' } });
    expect((await buscar('92977776666')).body.origem).toBeNull();
  });

  it('número de OUTRO usuário não aparece', async () => {
    const outro = await prisma.user.create({ data: { name: 'Outro', email: 'outro-origem@test.com', password: 'x' } });
    await prisma.whatsappConversation.create({
      data: { userId: outro.id, leadPhone: '5592955554444', origemCanal: 'google', origemCampanhaId: '999' },
    });
    expect((await buscar('92955554444')).body.origem).toBeNull();
    await prisma.whatsappConversation.deleteMany({ where: { userId: outro.id } });
    await prisma.user.delete({ where: { id: outro.id } });
  });

  it('telefone incompleto → 400; sem login → 401', async () => {
    expect((await buscar('9999')).status).toBe(400);
    expect((await request(app).get('/api/whatsapp/origem-do-telefone?telefone=92981234567')).status).toBe(401);
  });
});
