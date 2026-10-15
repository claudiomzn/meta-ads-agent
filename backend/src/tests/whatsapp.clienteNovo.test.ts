// O bot só fala com CLIENTE NOVO (Luiz, 15/10/2026: "o bot está enviando
// mensagens aleatórias para alguns clientes"). Duas brechas fechadas:
//
// 1. Cliente antigo que clica no anúncio (ou no botão do site) chegava com o
//    referral/código e passava como lead novo. Agora, se o número já tem
//    conversa com este WhatsApp, o bot não abre conversa.
// 2. Mensagem velha reentregue pela Evolution na reconexão era respondida
//    como se o cliente tivesse acabado de escrever.
//
// handleInbound direto (o caminho do webhook), com transporte Evolution de
// verdade e o `fetch` trocado: nada sai para a rede, e cada envio é contado.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';
import { WhatsappService, MENSAGEM_VELHA_MS } from '../services/whatsapp/whatsapp.service.js';
import { instanceName } from '../services/whatsapp/evolution.manager.js';
import { julgarHistorico } from '../services/whatsapp/contacts.js';
import { EvolutionTransport, momentoDoWhatsapp } from '../services/whatsapp/transport.js';

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));
vi.mock('../services/whatsapp/origem.meta.js', () => ({
  resolverCampanhaDoAnuncio: vi.fn(async () => null),
}));
vi.mock('../services/capi.service.js', () => ({
  CapiService: class { sendLead() { return Promise.resolve({ ok: true }); } },
}));

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;

// Resposta de /chat/findMessages por número; envios contados por destino.
const historicoPorNumero = new Map<string, unknown>();
const enviados: { to: string; text: string }[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'clientenovo@test.com' } });
  const res = await request(app).post('/api/auth/register')
    .send({ name: 'Cliente Novo', email: 'clientenovo@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'clientenovo@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  enviados.length = 0;
  historicoPorNumero.clear();
  vi.stubEnv('EVOLUTION_URL', 'http://evolution.teste');
  vi.stubEnv('EVOLUTION_API_KEY', 'chave-de-teste');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}');
    if (url.includes('/chat/findMessages/')) {
      const jid = String(body.where?.key?.remoteJid ?? '');
      const r = historicoPorNumero.get(jid.replace('@s.whatsapp.net', '')) ?? { messages: { records: [] } };
      return new Response(JSON.stringify(r), { status: 200 });
    }
    if (url.includes('/chat/findContacts/')) return new Response('[]', { status: 200 });
    if (url.includes('/message/sendText/')) {
      enviados.push({ to: body.number, text: body.text });
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function config(businessId: string) {
  await request(app).post('/api/whatsapp/config').set('Authorization', `Bearer ${token}`)
    .send({ businessName: 'Corretora', product: 'Plano de saúde', enabled: true, businessId, questions: ['Qual o seu nome?'] });
  // Limite 0: responde sem chamar a IA. Transporte Evolution de verdade.
  await prisma.whatsappConfig.update({
    where: { userId_businessId: { userId, businessId } },
    data: { maxBotMessages: 0, transport: 'evolution', transportConfig: { instance: instanceName(userId, businessId) } },
  });
}

const conversa = (businessId: string, leadPhone: string) => prisma.whatsappConversation.findUnique({
  where: { userId_businessId_leadPhone: { userId, businessId, leadPhone } },
});

const doAnuncio = { anuncio: { ctwaClid: 'CLID', anuncioId: 'AD-1' } };
const receber = (businessId: string, from: string, extra: Record<string, unknown> = {}) =>
  new WhatsappService(userId, businessId).handleInbound({
    from, text: 'Olá! Quero mais informações.', transport: 'evolution',
    mensagemId: 'MSG-AGORA', enviadaEm: Date.now(), ...doAnuncio, ...extra,
  });

describe('⭐ Brecha 1: cliente antigo que clica no anúncio não vira lead', () => {
  it('número com quem já se conversou (mensagem enviada antes): nada é enviado, nada é criado', async () => {
    await config('cn-1');
    historicoPorNumero.set('5592900000301', { messages: { records: [
      { key: { id: 'ANTIGA', fromMe: true }, messageTimestamp: Math.floor(Date.now() / 1000) - 86400 * 40 },
      { key: { id: 'MSG-AGORA', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) },
    ] } });
    const r = await receber('cn-1', '5592900000301');
    expect(r).toBeNull();
    expect(enviados).toEqual([]);
    expect(await conversa('cn-1', '5592900000301')).toBeNull();
  });

  it('número que já tinha escrito dias atrás (sem resposta registrada): também não', async () => {
    await config('cn-1');
    historicoPorNumero.set('5592900000302', [
      { key: { id: 'DELE', fromMe: false }, messageTimestamp: String(Math.floor(Date.now() / 1000) - 86400 * 3) },
    ]);
    expect(await receber('cn-1', '5592900000302')).toBeNull();
    expect(enviados).toEqual([]);
  });

  it('lead NOVO do anúncio (só a própria mensagem no histórico) continua sendo atendido', async () => {
    await config('cn-1');
    historicoPorNumero.set('5592900000303', { messages: { records: [
      { key: { id: 'MSG-AGORA', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) },
    ] } });
    const r = await receber('cn-1', '5592900000303');
    expect(r).not.toBeNull();
    expect(enviados.map((e) => e.to)).toContain('5592900000303');
    expect((await conversa('cn-1', '5592900000303'))?.origemCanal).toBe('meta_whatsapp');
  });

  it('Evolution fora do ar: segue atendendo (calar perderia o lead novo)', async () => {
    await config('cn-1');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes('/message/sendText/')) {
        enviados.push({ to: JSON.parse(init?.body ?? '{}').number, text: '' });
        return new Response('{}', { status: 200 });
      }
      return new Response('erro', { status: 500 });
    }));
    expect(await receber('cn-1', '5592900000304')).not.toBeNull();
  });
});

describe('⭐ Brecha 2: mensagem velha reentregue não é respondida', () => {
  it('mensagem enviada há 2 horas, chegando agora: ignorada, nada enviado', async () => {
    await config('cn-2');
    const r = await receber('cn-2', '5592900000401', { enviadaEm: Date.now() - 2 * 60 * 60 * 1000 });
    expect(r).toBeNull();
    expect(enviados).toEqual([]);
    expect(await conversa('cn-2', '5592900000401')).toBeNull();
  });

  it('mensagem de agora segue normal', async () => {
    await config('cn-2');
    expect(await receber('cn-2', '5592900000402', { enviadaEm: Date.now() - 30 * 1000 })).not.toBeNull();
    expect(MENSAGEM_VELHA_MS).toBe(15 * 60 * 1000);
  });
});

describe('leitura do webhook e do histórico', () => {
  it('o webhook da Evolution traz o id e o horário da mensagem', () => {
    const t = new EvolutionTransport('http://x', 'k', 'inst');
    const msg = t.parseInbound({
      event: 'messages.upsert',
      data: { key: { remoteJid: '5592900000501@s.whatsapp.net', fromMe: false, id: 'ABC' }, messageTimestamp: 1760000000, message: { conversation: 'oi' } },
    });
    expect(msg?.mensagemId).toBe('ABC');
    expect(msg?.enviadaEm).toBe(1760000000 * 1000);
  });

  it('horário em segundos, texto, Long do protobuf ou ms; lixo vira null', () => {
    expect(momentoDoWhatsapp(1760000000)).toBe(1760000000000);
    expect(momentoDoWhatsapp('1760000000')).toBe(1760000000000);
    expect(momentoDoWhatsapp({ low: 1760000000, high: 0 })).toBe(1760000000000);
    expect(momentoDoWhatsapp(1760000000000)).toBe(1760000000000);
    expect(momentoDoWhatsapp(0)).toBeNull();
    expect(momentoDoWhatsapp('ontem')).toBeNull();
    expect(momentoDoWhatsapp(undefined)).toBeNull();
  });

  it('julgarHistorico: o próprio lead mandando duas mensagens seguidas NÃO é cliente antigo', () => {
    const agora = 1760000000000;
    const r = julgarHistorico({ messages: { records: [
      { key: { id: 'A', fromMe: false }, messageTimestamp: agora / 1000 - 120 },
      { key: { id: 'B', fromMe: false }, messageTimestamp: agora / 1000 },
    ] } }, { mensagemId: 'B', enviadaEm: agora, agora });
    expect(r.existente).toBe(false);
  });

  it('julgarHistorico: formato desconhecido não afirma nada', () => {
    expect(julgarHistorico({ foo: 1 }, { agora: 1 }).existente).toBeNull();
    expect(julgarHistorico(null, { agora: 1 }).existente).toBeNull();
  });
});
