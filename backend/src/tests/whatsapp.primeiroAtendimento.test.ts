// O bot faz SÓ o primeiro atendimento (06/10/2026) — três brechas fechadas:
//
// 1. Sem gatilho configurado, qualquer número novo virava conversa (parente,
//    fornecedor, cliente antigo). Agora só abre quem nasceu de anúncio:
//    referral do clique-para-WhatsApp, código do site "(ref. …)" ou gatilho.
// 2. Quem estourava o limite de mensagens do modo IA saía QUENTE e subia
//    conversão para Google/Meta. Agora vai ao vendedor SEM rótulo.
// 3. Conversa largada no meio ficava aberta para sempre: o lead voltava meses
//    depois e o bot retomava. Agora, 48h sem mensagem = encerrada em silêncio.
//
// Estes testes chamam handleInbound direto — é o caminho do webhook de
// verdade. O simulador do painel (/simulate) faz o papel de lead de anúncio.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';
import { WhatsappService, podeAbrirConversa, CONVERSA_EXPIRA_MS } from '../services/whatsapp/whatsapp.service.js';

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));

// A pergunta à Meta "qual a campanha deste anúncio?" — sem rede.
vi.mock('../services/whatsapp/origem.meta.js', () => ({
  resolverCampanhaDoAnuncio: vi.fn(async () => null),
}));

// ⚠️ CLASSE de verdade: o serviço faz `new CapiService(...)`. Com vi.fn() o
// TypeError some no try/catch e o `not.toHaveBeenCalled()` passaria sempre.
const mockSendLead = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../services/capi.service.js', () => ({
  CapiService: class {
    sendLead(...args: unknown[]) { return mockSendLead(...args); }
  },
}));

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'primeiro@test.com' } });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Primeiro Atendimento', email: 'primeiro@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'primeiro@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => { mockSendLead.mockClear(); });

async function config(businessId: string, extra: Record<string, unknown> = {}, direto: Record<string, unknown> = {}) {
  await request(app).post('/api/whatsapp/config').set('Authorization', `Bearer ${token}`)
    .send({ businessName: 'Corretora', product: 'Plano de saúde', enabled: true, businessId, ...extra });
  if (Object.keys(direto).length) {
    await prisma.whatsappConfig.update({ where: { userId_businessId: { userId, businessId } }, data: direto });
  }
}

const conversa = (businessId: string, leadPhone: string) => prisma.whatsappConversation.findUnique({
  where: { userId_businessId_leadPhone: { userId, businessId, leadPhone } },
});

// Webhook de verdade: sem `simulado`.
const receber = (businessId: string, from: string, text: string, extra: Record<string, unknown> = {}) =>
  new WhatsappService(userId, businessId).handleInbound({ from, text, transport: 'log', ...extra });

describe('podeAbrirConversa — só abre quem nasceu de anúncio', () => {
  it('sem gatilho: mensagem comum NÃO abre; anúncio, código do site e simulador abrem', () => {
    expect(podeAbrirConversa('', { text: 'oi, tudo bem?' })).toBe(false);
    expect(podeAbrirConversa(null, { text: 'oi', anuncio: { ctwaClid: 'X', anuncioId: '1' } })).toBe(true);
    expect(podeAbrirConversa('', { text: 'Quero cotação\n\n(ref. SAM-G-123456)' })).toBe(true);
    expect(podeAbrirConversa('', { text: 'oi', simulado: true })).toBe(true);
  });

  it('com gatilho: o gatilho continua valendo, e o anúncio abre mesmo sem ele', () => {
    expect(podeAbrirConversa('cotação', { text: 'oi' })).toBe(false);
    expect(podeAbrirConversa('cotação', { text: 'quero uma cotacao' })).toBe(true);
    expect(podeAbrirConversa('cotação', { text: 'Olá! Quero mais informações.', anuncio: { ctwaClid: 'X', anuncioId: '1' } })).toBe(true);
    // Com gatilho, o simulador obedece o gatilho (é o que os testes de gatilho exercitam).
    expect(podeAbrirConversa('cotação', { text: 'oi', simulado: true })).toBe(false);
  });
});

describe('⭐ Brecha 1: gatilho em branco não abre conversa com qualquer um', () => {
  it('número desconhecido mandando "oi" pelo webhook: ignorado, nada é criado', async () => {
    await config('pa-1'); // sem gatilho
    const r = await receber('pa-1', '5592900000101', 'oi, tudo bem? é a tia Maria');
    expect(r).toBeNull();
    expect(await conversa('pa-1', '5592900000101')).toBeNull();
  });

  it('lead do anúncio da Meta (referral CTWA) abre a conversa', async () => {
    await config('pa-1', {}, { maxBotMessages: 0 }); // limite 0: responde sem chamar a IA
    const r = await receber('pa-1', '5592900000102', 'Olá! Quero mais informações.',
      { anuncio: { ctwaClid: 'CLID', anuncioId: 'AD-1' } });
    expect(r).not.toBeNull();
    expect((await conversa('pa-1', '5592900000102'))?.origemCanal).toBe('meta_whatsapp');
  });

  it('lead do site (código "(ref. …)") abre a conversa', async () => {
    const r = await receber('pa-1', '5592900000103', 'Quero uma cotação do plano Samel.\n\n(ref. SAM-G)');
    expect(r).not.toBeNull();
    expect((await conversa('pa-1', '5592900000103'))?.origemRef).toBe('SAM-G');
  });
});

describe('⭐ Brecha 2: estourar o limite de mensagens não vira QUENTE', () => {
  it('vai ao vendedor SEM rótulo e sem conversão para Google/Meta', async () => {
    await config('pa-2', {}, { maxBotMessages: 0, handoffContact: '+5592999990000' });
    const r = await receber('pa-2', '5592900000201', 'oi (ref. SAM-G)');
    expect(r?.state).toBe('handoff');
    const conv = await conversa('pa-2', '5592900000201');
    expect(conv?.state).toBe('handoff');
    expect(conv?.label).toBeNull();
    expect(conv?.capiLeadFired).toBe(false);
    expect(mockSendLead).not.toHaveBeenCalled();
  });
});

describe('⭐ Brecha 3: conversa largada no meio expira em 48h', () => {
  it('lead que volta depois de 3 dias: bot fica mudo e a conversa fecha', async () => {
    await config('pa-3', {}, { maxBotMessages: 5 });
    await prisma.whatsappConversation.create({
      data: { userId, businessId: 'pa-3', leadPhone: '5592900000301', state: 'qualifying', botMessages: 0 },
    });
    // @updatedAt é regravado pelo Prisma a cada update: o "3 dias atrás" vai por SQL.
    await prisma.$executeRaw`UPDATE "WhatsappConversation" SET "updatedAt" = NOW() - INTERVAL '3 days'
      WHERE "userId" = ${userId} AND "businessId" = 'pa-3' AND "leadPhone" = '5592900000301'`;

    const r = await receber('pa-3', '5592900000301', 'oi, vocês vendem seguro de carro?');
    expect(r).toBeNull();
    expect((await conversa('pa-3', '5592900000301'))?.state).toBe('closed');
  });

  it('conversa recente continua normalmente (controle)', async () => {
    await prisma.whatsappConfig.update({ where: { userId_businessId: { userId, businessId: 'pa-3' } }, data: { maxBotMessages: 0 } });
    await prisma.whatsappConversation.create({
      data: { userId, businessId: 'pa-3', leadPhone: '5592900000302', state: 'qualifying', botMessages: 0 },
    });
    const r = await receber('pa-3', '5592900000302', 'tenho 34 anos');
    expect(r).not.toBeNull();
    expect(CONVERSA_EXPIRA_MS).toBe(48 * 60 * 60 * 1000);
  });
});
