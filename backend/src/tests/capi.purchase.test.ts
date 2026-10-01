import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

// Rede da Meta: só o axios.post é falso. CapiService, rota, Prisma e
// criptografia rodam de verdade — o mock de classe que o CLAUDE.md alerta
// (vi.fn não construível, TypeError engolido) não existe aqui.
const mockPost = vi.fn();
vi.mock('axios', async (orig) => {
  const real = (await orig()) as { default: Record<string, unknown> };
  return { default: { ...real.default, post: (...a: unknown[]) => mockPost(...a) } };
});

process.env.DATABASE_URL = 'postgresql://postgres:test@localhost:5433/metaads_test';
process.env.JWT_SECRET = 'test-jwt-secret-32chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-enc-key-32chars-minimum-ok!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_APP_SECRET = 'test-app-secret';
execSync('npx prisma db push --force-reset', { stdio: 'ignore' });

const { default: authRoutes } = await import('../routes/auth.routes.js');
const { default: capiRoutes, momentoDaVenda } = await import('../routes/capi.routes.js');
const { encrypt } = await import('../services/crypto.service.js');

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/capi', capiRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Venda Test', email: 'venda@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
  await prisma.mCPConnection.create({
    data: { userId, metaAccessToken: encrypt('tok_meta'), adAccountIds: '[]', connected: true, metaPixelId: 'px_123' },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'venda@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { events_received: 1 } });
});

const hoje = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10); // data de Manaus
const comprar = (body: Record<string, unknown>) =>
  request(app).post('/api/capi/purchase').set('Authorization', `Bearer ${token}`)
    .send({ saleId: 'sale-1', phone: '(92) 99999-1234', value: 850, closedAt: hoje(), ...body });

describe('POST /api/capi/purchase', () => {
  it('⭐ envia Purchase com valor, telefone hasheado e event_id da venda', async () => {
    const res = await comprar({});
    expect(res.body).toEqual({ ok: true, eventsReceived: 1 });
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0] as [string, { data: Record<string, any>[] }];
    expect(url).toContain('/px_123/events');
    const ev = body.data[0];
    expect(ev.event_name).toBe('Purchase');
    expect(ev.event_id).toBe('venda_sale-1'); // mesmo id → Meta não conta duas vezes
    expect(ev.custom_data).toEqual({ value: 850, currency: 'BRL' });
    expect(ev.user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/); // hash, nunca o número cru
    expect(JSON.stringify(body)).not.toContain('99999');
  });

  it('⭐ Meta responde 200 sem confirmar o evento → ok:false, não "sucesso"', async () => {
    mockPost.mockResolvedValue({ data: { events_received: 0, messages: ['recusado'] } });
    const res = await comprar({});
    expect(res.body.ok).toBe(false);
  });

  it('erro HTTP da Meta → ok:false com o motivo', async () => {
    mockPost.mockRejectedValue(new Error('rede'));
    const res = await comprar({});
    expect(res.body.ok).toBe(false);
  });

  it('venda com mais de 7 dias é recusada antes de chamar a Meta', async () => {
    const velha = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const res = await comprar({ closedAt: velha });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/7 dias/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ['sem telefone', { phone: '' }],
    ['telefone curto', { phone: '9999' }],
    ['valor zero', { value: 0 }],
    ['valor negativo', { value: -10 }],
    ['saleId com caractere estranho', { saleId: 'a/../b' }],
    ['data em formato errado', { closedAt: '01/10/2026' }],
    ['data inexistente', { closedAt: '2026-13-45' }],
  ])('400 para %s, sem chamar a Meta', async (_n, body) => {
    const res = await comprar(body);
    expect(res.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sem login: 401', async () => {
    const res = await request(app).post('/api/capi/purchase').send({ saleId: 'x', phone: '92999991234', value: 1 });
    expect(res.status).toBe(401);
  });
});

describe('Lead também exige confirmação da Meta (mesma porta de envio)', () => {
  it('⭐ /capi/test com events_received 0 → ok:false (antes dizia ok:true)', async () => {
    mockPost.mockResolvedValue({ data: { events_received: 0 } });
    const res = await request(app).post('/api/capi/test').set('Authorization', `Bearer ${token}`)
      .send({ testEventCode: 'TEST1' });
    expect(res.body.ok).toBe(false);
  });
});

describe('momentoDaVenda', () => {
  it('venda de hoje vira "agora" — meio-dia pode estar no futuro e a Meta recusa', () => {
    const agora = Date.parse('2026-10-01T09:00:00-04:00');
    expect(momentoDaVenda('2026-10-01', agora)).toBe(Math.floor(agora / 1000));
  });
  it('dia anterior vira meio-dia de Manaus', () => {
    const agora = Date.parse('2026-10-01T09:00:00-04:00');
    expect(momentoDaVenda('2026-09-29', agora)).toBe(Date.parse('2026-09-29T16:00:00Z') / 1000);
  });
});
