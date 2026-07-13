import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Motor de IA: nunca chama a Anthropic de verdade nos testes — devolve uma
// resposta fixa de "qualificando" (não encerra, não dispara CAPI/Google).
const mockNextReply = vi.fn().mockResolvedValue({
  reply: 'Oi! Me conta um pouco mais sobre o que você procura?',
  state: 'qualifying',
  done: false,
});
vi.mock('../services/whatsapp/qualification.service.js', () => ({
  nextReply: (...args: unknown[]) => mockNextReply(...args),
}));

// E-mail: nunca envia de verdade (usado tanto pelo welcome do /register
// quanto pelo aviso de recarga do bot).
vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));

// Asaas: simula o gateway de cobrança sem rede — cada chamada de
// createOverageCharge devolve um paymentId único (contador), permitindo
// distinguir cobranças concorrentes nos testes de corrida.
let asaasChargeCounter = 0;
const mockEnsureAsaasCustomer = vi.fn().mockResolvedValue('cus_fake');
const mockCreateOverageCharge = vi.fn().mockImplementation(async () => {
  asaasChargeCounter += 1;
  return { asaasPaymentId: `pay_fake_${asaasChargeCounter}`, invoiceUrl: `https://asaas.test/${asaasChargeCounter}` };
});
vi.mock('../services/asaas.service.js', () => ({
  asaasConfigured: () => true,
  ensureAsaasCustomer: (...args: unknown[]) => mockEnsureAsaasCustomer(...args),
  createOverageCharge: (...args: unknown[]) => mockCreateOverageCharge(...args),
}));

vi.mock('../services/capi.service.js', () => ({
  CapiService: vi.fn().mockImplementation(() => ({
    sendLead: vi.fn().mockResolvedValue({ ok: true }),
  })),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'wa@test.com' } });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'WA Test', email: 'wa@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappCharge.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'wa@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockNextReply.mockClear();
  mockEnsureAsaasCustomer.mockClear();
  mockCreateOverageCharge.mockClear();
});

// upsertConfig() só expõe os campos "de persona" da rota POST /config —
// dailyFreeConversations não é setável pelo cliente ali (é regra fixa do
// produto). Para os testes que precisam derrubar a franquia rapidamente,
// aplicamos um PATCH direto via Prisma depois de criar a config pela rota
// (assim a rota em si também fica exercitada).
async function upsertConfig(
  businessId: string,
  overrides: Record<string, unknown> = {},
  directPatch: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/whatsapp/config')
    .set('Authorization', `Bearer ${token}`)
    .send({
      businessName: `Negócio ${businessId}`,
      product: 'Produto Teste',
      enabled: true,
      businessId,
      ...overrides,
    });
  if (Object.keys(directPatch).length) {
    await prisma.whatsappConfig.update({
      where: { userId_businessId: { userId, businessId } },
      data: directPatch,
    });
  }
  return res;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('Config por negócio', () => {
  it('cria configs independentes para negócios diferentes da mesma conta', async () => {
    const a = await upsertConfig('biz-a', { businessName: 'Negócio A' });
    const b = await upsertConfig('biz-b', { businessName: 'Negócio B' });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.businessId).toBe('biz-a');
    expect(b.body.businessId).toBe('biz-b');
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('config sem businessId cai no negócio "default" (retrocompatibilidade)', async () => {
    const res = await request(app)
      .post('/api/whatsapp/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Legado', product: 'Produto', enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.businessId).toBe('default');

    const getRes = await request(app)
      .get('/api/whatsapp/config')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.body.businessId).toBe('default');
  });

  it('GET /businesses lista todos os negócios da conta', async () => {
    const res = await request(app)
      .get('/api/whatsapp/businesses')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((b: { businessId: string }) => b.businessId);
    expect(ids).toEqual(expect.arrayContaining(['default', 'biz-a', 'biz-b']));
  });
});

describe('Franquia diária por negócio', () => {
  it('a franquia é contada por negócio, não globalmente pela conta', async () => {
    await upsertConfig('franq-a', {}, { dailyFreeConversations: 1 });
    await upsertConfig('franq-b', {}, { dailyFreeConversations: 1 });

    // Negócio A: 2 conversas novas — a 1ª cabe na franquia, a 2ª estoura.
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'franq-a', from: '+551190000001', text: 'oi' });
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'franq-a', from: '+551190000002', text: 'oi' });

    const convsA = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'franq-a' },
      orderBy: { createdAt: 'asc' },
    });
    expect(convsA).toHaveLength(2);
    expect(convsA[0].billable).toBe(false); // 1ª — dentro da franquia
    expect(convsA[1].billable).toBe(true); // 2ª — estourou a franquia de 1

    // Negócio B: franquia própria, ainda intacta mesmo com A já estourada.
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'franq-b', from: '+551190000003', text: 'oi' });

    const convsB = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'franq-b' },
    });
    expect(convsB).toHaveLength(1);
    expect(convsB[0].billable).toBe(false); // franquia de B não foi afetada por A
  });
});

describe('Cobrança de recarga: corrida por negócio', () => {
  it('duas mensagens concorrentes no MESMO negócio geram só 1 cobrança PENDING', async () => {
    await upsertConfig('race-a', { billingCpfCnpj: '12345678900' }, { dailyFreeConversations: 0 });

    // Duas conversas NOVAS e concorrentes no mesmo negócio — ambas sem saldo
    // pré-pago, ambas tentam abrir uma cobrança de recarga ao mesmo tempo.
    await Promise.all([
      request(app).post('/api/whatsapp/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessId: 'race-a', from: '+551190001001', text: 'oi' }),
      request(app).post('/api/whatsapp/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessId: 'race-a', from: '+551190001002', text: 'oi' }),
    ]);

    const pending = await prisma.whatsappCharge.findMany({
      where: { userId, businessId: 'race-a', status: 'PENDING' },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].pendingKey).toBe(`${userId}:race-a`);
  });

  it('negócios diferentes da mesma conta não bloqueiam a cobrança um do outro', async () => {
    await upsertConfig('race-b', { billingCpfCnpj: '12345678900' }, { dailyFreeConversations: 0 });
    await upsertConfig('race-c', { billingCpfCnpj: '12345678900' }, { dailyFreeConversations: 0 });

    // Concorrentes, mas em negócios DIFERENTES — cada um deve conseguir abrir
    // a própria cobrança PENDING (pendingKey distinto por negócio).
    await Promise.all([
      request(app).post('/api/whatsapp/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessId: 'race-b', from: '+551190002001', text: 'oi' }),
      request(app).post('/api/whatsapp/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessId: 'race-c', from: '+551190002002', text: 'oi' }),
    ]);

    const [pendingB, pendingC] = await Promise.all([
      prisma.whatsappCharge.findMany({ where: { userId, businessId: 'race-b', status: 'PENDING' } }),
      prisma.whatsappCharge.findMany({ where: { userId, businessId: 'race-c', status: 'PENDING' } }),
    ]);
    expect(pendingB).toHaveLength(1);
    expect(pendingC).toHaveLength(1);
    expect(pendingB[0].pendingKey).not.toBe(pendingC[0].pendingKey);
  });

  it('creditPaidRecharge credita o saldo do negócio certo (não vaza pra outro negócio da conta)', async () => {
    await upsertConfig('credit-a', { billingCpfCnpj: '12345678900' }, { dailyFreeConversations: 0 });
    await upsertConfig('credit-b', { billingCpfCnpj: '12345678900' }, { dailyFreeConversations: 0 });

    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'credit-a', from: '+551190003001', text: 'oi' });

    const charge = await prisma.whatsappCharge.findFirstOrThrow({
      where: { userId, businessId: 'credit-a', status: 'PENDING' },
    });

    const { creditPaidRecharge } = await import('../services/whatsapp/whatsapp.service.js');
    await creditPaidRecharge(charge.asaasPaymentId);

    const [configA, configB] = await Promise.all([
      prisma.whatsappConfig.findUniqueOrThrow({ where: { userId_businessId: { userId, businessId: 'credit-a' } } }),
      prisma.whatsappConfig.findUniqueOrThrow({ where: { userId_businessId: { userId, businessId: 'credit-b' } } }),
    ]);
    expect(configA.prepaidMessagesRemaining).toBe(charge.messagesGranted);
    expect(configB.prepaidMessagesRemaining).toBe(0); // negócio B não foi tocado
  });
});

describe('Mesmo lead falando com dois negócios da mesma conta', () => {
  it('cria conversas independentes (mesmo leadPhone, businessId diferente)', async () => {
    await upsertConfig('multi-x', {});
    await upsertConfig('multi-y', {});

    const phone = '+551190009999';
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'multi-x', from: phone, text: 'quero saber mais' });
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'multi-y', from: phone, text: 'quero saber mais' });

    const convs = await prisma.whatsappConversation.findMany({
      where: { userId, leadPhone: phone },
      orderBy: { businessId: 'asc' },
    });
    expect(convs).toHaveLength(2);
    expect(convs.map((c) => c.businessId)).toEqual(['multi-x', 'multi-y']);
    // Conversas isoladas: cada uma tem seu próprio id e histórico independente.
    expect(convs[0].id).not.toBe(convs[1].id);
    expect((convs[0].history as unknown[]).length).toBe(2); // user + assistant
    expect((convs[1].history as unknown[]).length).toBe(2);
  });
});

describe('Palavra-gatilho por negócio', () => {
  it('1ª mensagem SEM o gatilho: nada é criado (nem conversa, nem franquia, nem IA)', async () => {
    await upsertConfig('trig-a', { triggerKeyword: 'Cotação' });

    const res = await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'trig-a', from: '+551190007001', text: 'oi, tudo bem?' });

    expect(res.body).toEqual({ skipped: 'bot desligado ou sem config' }); // handleInbound retornou null
    const convs = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'trig-a' },
    });
    expect(convs).toHaveLength(0); // nenhuma conversa criada
    expect(mockNextReply).not.toHaveBeenCalled(); // IA nunca chamada
  });

  it('1ª mensagem COM o gatilho em variação de caixa/acento cria a conversa e responde', async () => {
    // Config "Cotação" (com acento e maiúscula) casa com "cotacao" cru na msg.
    const res = await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'trig-a', from: '+551190007002', text: 'quero uma cotacao' });

    expect(res.body.reply).toBeDefined();
    const conv = await prisma.whatsappConversation.findUnique({
      where: { userId_businessId_leadPhone: { userId, businessId: 'trig-a', leadPhone: '+551190007002' } },
    });
    expect(conv).not.toBeNull();
    expect(mockNextReply).toHaveBeenCalled();
  });

  it('conversa JÁ existente responde normal mesmo sem o gatilho na mensagem', async () => {
    // A conversa de +551190007002 nasceu no teste anterior (com gatilho);
    // a 2ª mensagem não precisa repetir o gatilho.
    const res = await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'trig-a', from: '+551190007002', text: 'pode me falar mais?' });

    expect(res.body.reply).toBeDefined();
    expect(mockNextReply).toHaveBeenCalled();
  });

  it('sem triggerKeyword configurado, qualquer 1ª mensagem cria conversa (comportamento atual)', async () => {
    await upsertConfig('trig-b', {}); // sem gatilho

    const res = await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'trig-b', from: '+551190007003', text: 'oi' });

    expect(res.body.reply).toBeDefined();
    const convs = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'trig-b' },
    });
    expect(convs).toHaveLength(1);
  });

  it('a franquia diária não é consumida por mensagens barradas pelo gatilho', async () => {
    await upsertConfig('trig-c', { triggerKeyword: 'orçamento' }, { dailyFreeConversations: 1 });

    // 3 mensagens sem gatilho — nenhuma pode consumir a franquia de 1.
    for (const phone of ['+551190007101', '+551190007102', '+551190007103']) {
      await request(app).post('/api/whatsapp/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessId: 'trig-c', from: phone, text: 'oi' });
    }

    // Agora a 1ª mensagem válida (com gatilho, sem acento) — deve entrar
    // DENTRO da franquia (billable=false), provando que as barradas não contaram.
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'trig-c', from: '+551190007104', text: 'me passa um orcamento?' });

    const convs = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'trig-c' },
    });
    expect(convs).toHaveLength(1);
    expect(convs[0].billable).toBe(false);
  });
});

describe('Remoção de negócio', () => {
  it('não permite remover o negócio "default"', async () => {
    const res = await request(app)
      .delete('/api/whatsapp/businesses/default')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('desativa a config do negócio removido sem apagar as conversas', async () => {
    await upsertConfig('to-remove', {});
    await request(app).post('/api/whatsapp/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'to-remove', from: '+551190005555', text: 'oi' });

    const res = await request(app)
      .delete('/api/whatsapp/businesses/to-remove')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const config = await prisma.whatsappConfig.findUniqueOrThrow({
      where: { userId_businessId: { userId, businessId: 'to-remove' } },
    });
    expect(config.enabled).toBe(false);

    const convs = await prisma.whatsappConversation.findMany({
      where: { userId, businessId: 'to-remove' },
    });
    expect(convs).toHaveLength(1); // histórico preservado
  });
});
