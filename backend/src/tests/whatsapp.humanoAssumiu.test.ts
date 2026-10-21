// O robô entrava no meio da conversa da atendente (Luiz, 21/10/2026: "ele
// entra na hora errada, no meio da conversa com os clientes. Atrapalha tudo.").
// Três causas, três travas:
//
// 1. A resposta que a atendente digita no celular da empresa chega como
//    fromMe e era descartada como "eco do bot" — o robô nunca sabia que uma
//    pessoa tinha assumido. Agora: fromMe que não é do robô → estado `humano`,
//    silêncio para sempre naquele número.
// 2. Histórico indisponível (Evolution lenta) era tratado como número novo.
//    Agora: na dúvida, o robô não abre conversa.
// 3. Mensagem que chega com minutos de atraso abria conversa depois que a
//    atendente já tinha respondido. Agora: só abre com atraso de até 2 min.
//
// handleInbound direto (o caminho do webhook), com o EvolutionTransport de
// verdade e o `fetch` trocado: nada sai para a rede, cada envio é contado.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';
import { WhatsappService, ATRASO_MAXIMO_PARA_ABRIR_MS } from '../services/whatsapp/whatsapp.service.js';
import { instanceName } from '../services/whatsapp/evolution.manager.js';
import { EvolutionTransport } from '../services/whatsapp/transport.js';

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

const enviados: { to: string; text: string; id: string }[] = [];
let historicoFora = false;
let contadorDeEnvio = 0;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'humanoassumiu@test.com' } });
  const res = await request(app).post('/api/auth/register')
    .send({ name: 'Humano Assumiu', email: 'humanoassumiu@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'humanoassumiu@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  enviados.length = 0;
  historicoFora = false;
  vi.stubEnv('EVOLUTION_URL', 'http://evolution.teste');
  vi.stubEnv('EVOLUTION_API_KEY', 'chave-de-teste');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}');
    if (url.includes('/chat/findMessages/')) {
      // Igual à Evolution do Luiz em 18/10: a consulta estoura o tempo.
      if (historicoFora) throw new Error('The operation was aborted due to timeout');
      return new Response(JSON.stringify({ messages: { records: [] } }), { status: 200 });
    }
    if (url.includes('/chat/findContacts/')) return new Response('[]', { status: 200 });
    if (url.includes('/message/sendText/')) {
      // A Evolution v2 devolve o key.id do envio — é ele que volta no eco.
      const id = `ROBO-${++contadorDeEnvio}`;
      enviados.push({ to: body.number, text: body.text, id });
      return new Response(JSON.stringify({ key: { id, fromMe: true } }), { status: 201 });
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
    .send({
      businessName: 'Corretora', product: 'Plano de saúde', enabled: true, businessId,
      questions: ['Qual o seu nome?', 'Para quantas pessoas é o plano?', 'Pretende contratar ainda este mês?'],
    });
  await prisma.whatsappConfig.update({
    where: { userId_businessId: { userId, businessId } },
    data: { transport: 'evolution', transportConfig: { instance: instanceName(userId, businessId) } },
  });
}

const conversa = (businessId: string, leadPhone: string) => prisma.whatsappConversation.findUnique({
  where: { userId_businessId_leadPhone: { userId, businessId, leadPhone } },
});

// Tudo passa pelo parse do webhook de verdade: é lá que o fromMe morria.
const transporte = new EvolutionTransport('http://evolution.teste', 'chave-de-teste', 'inst');
let seq = 0;
function webhook(numero: string, texto: string, opts: { fromMe?: boolean; id?: string; enviadaEm?: number } = {}) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: Boolean(opts.fromMe), id: opts.id ?? `MSG-${++seq}` },
      messageTimestamp: Math.floor((opts.enviadaEm ?? Date.now()) / 1000),
      pushName: 'Lead',
      message: { conversation: texto },
    },
  };
}
async function chega(businessId: string, payload: unknown) {
  const msg = transporte.parseInbound(payload);
  if (!msg) return null;
  return new WhatsappService(userId, businessId).handleInbound(msg);
}
// O botão do site traz o código "(ref. …)": é a porta de lead de anúncio.
const DO_SITE = 'Olá! Quero uma cotação de plano de saúde (ref. HAP-G)';

describe('⭐ 1. A pessoa assumiu, o robô sai', () => {
  it('atendente responde pelo celular no meio do roteiro: o robô cala para sempre', async () => {
    await config('ha-1');
    const lead = '5592911110001';
    await chega('ha-1', webhook(lead, DO_SITE));
    expect(enviados.filter((e) => e.to === lead).length).toBeGreaterThan(0);

    // O eco das mensagens do próprio robô NÃO é gente.
    for (const e of [...enviados]) await chega('ha-1', webhook(lead, e.text, { fromMe: true, id: e.id }));
    expect((await conversa('ha-1', lead))?.state).not.toBe('humano');

    // A atendente digita no celular da empresa.
    await chega('ha-1', webhook(lead, 'Oi! Aqui é a Ana, já vou te passar os valores.', { fromMe: true }));
    expect((await conversa('ha-1', lead))?.state).toBe('humano');

    // O lead responde: o robô não manda a próxima pergunta. Nem depois.
    enviados.length = 0;
    expect(await chega('ha-1', webhook(lead, 'João'))).toBeNull();
    expect(await chega('ha-1', webhook(lead, '3 pessoas'))).toBeNull();
    expect(enviados).toEqual([]);
    expect((await conversa('ha-1', lead))?.state).toBe('humano');
  });

  it('eco do robô sem id conhecido (ex.: depois de um restart) é reconhecido pelo texto', async () => {
    await config('ha-1');
    const lead = '5592911110002';
    await chega('ha-1', webhook(lead, DO_SITE));
    const primeira = enviados.find((e) => e.to === lead)!;
    await chega('ha-1', webhook(lead, primeira.text, { fromMe: true, id: 'ID-QUE-NINGUEM-REGISTROU' }));
    expect((await conversa('ha-1', lead))?.state).not.toBe('humano');
    // E o roteiro segue normalmente.
    enviados.length = 0;
    expect(await chega('ha-1', webhook(lead, 'João'))).not.toBeNull();
    expect(enviados.length).toBe(1);
  });

  it('atendente responde ANTES de a mensagem do lead chegar ao backend: o robô não abre', async () => {
    await config('ha-1');
    const lead = '5592911110003';
    await chega('ha-1', webhook(lead, 'Bom dia! Já te atendo.', { fromMe: true }));
    expect(await chega('ha-1', webhook(lead, DO_SITE))).toBeNull();
    expect(enviados).toEqual([]);
    expect(await conversa('ha-1', lead)).toBeNull();
  });

  it('o webhook passa a entregar o fromMe ao serviço (antes morria no parse)', () => {
    const msg = transporte.parseInbound(webhook('5592911110004', 'oi', { fromMe: true, id: 'X' }));
    expect(msg?.fromMe).toBe(true);
    expect(msg?.mensagemId).toBe('X');
  });
});

describe('⭐ 2. Na dúvida, não entra', () => {
  it('histórico indisponível (timeout da Evolution): nenhuma conversa aberta, nada enviado', async () => {
    await config('ha-2');
    historicoFora = true;
    expect(await chega('ha-2', webhook('5592911110101', DO_SITE))).toBeNull();
    expect(enviados).toEqual([]);
    expect(await conversa('ha-2', '5592911110101')).toBeNull();
  });
});

describe('⭐ 3. Mensagem atrasada não abre conversa', () => {
  it('lead novo cuja mensagem chega 5 min depois de enviada: o robô não abre', async () => {
    await config('ha-3');
    const r = await chega('ha-3', webhook('5592911110201', DO_SITE, { enviadaEm: Date.now() - 5 * 60 * 1000 }));
    expect(r).toBeNull();
    expect(enviados).toEqual([]);
    expect(await conversa('ha-3', '5592911110201')).toBeNull();
  });

  it('atraso de 30 s ainda abre (o lead de agora continua sendo atendido)', async () => {
    await config('ha-3');
    expect(await chega('ha-3', webhook('5592911110202', DO_SITE, { enviadaEm: Date.now() - 30 * 1000 }))).not.toBeNull();
    expect(ATRASO_MAXIMO_PARA_ABRIR_MS).toBe(2 * 60 * 1000);
  });

  it('conversa JÁ aberta continua aceitando resposta com atraso de 5 min (vale o limite de 15)', async () => {
    await config('ha-3');
    const lead = '5592911110203';
    await chega('ha-3', webhook(lead, DO_SITE));
    enviados.length = 0;
    expect(await chega('ha-3', webhook(lead, 'João', { enviadaEm: Date.now() - 5 * 60 * 1000 }))).not.toBeNull();
    expect(enviados.length).toBe(1);
  });
});
