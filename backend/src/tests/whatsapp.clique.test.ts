// Clique do anúncio registrado pelo site → gclid na conversão QUENTE (07/10/2026).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import cliqueRoutes, { validarClique, dentroDoLimite } from '../routes/clique.routes.js';
import { lerRefDoSite, resolverOrigem } from '../services/whatsapp/origem.js';
import { WhatsappService, cliqueDaConversa } from '../services/whatsapp/whatsapp.service.js';

const prisma = new PrismaClient();
const app = express();
app.set('trust proxy', true);
app.use('/api/clique', cliqueRoutes);

const SITE = 'https://novo.tabelasamel.com.br';
const GCLID = 'Cj0KCQjw_abc-DEF123456';

describe('código do clique no "(ref. …)"', () => {
  it('⭐ lê o código depois do "~", com e sem campanha', () => {
    expect(lerRefDoSite('Oi\n\n(ref. SAM-G-21345678901~k7xq9pz2ab)')).toMatchObject({
      ref: 'SAM-G', campanhaId: '21345678901', clique: 'k7xq9pz2ab',
    });
    expect(lerRefDoSite('(ref. SAM-G~k7xq9pz2ab)')).toMatchObject({ campanhaId: null, clique: 'k7xq9pz2ab' });
  });

  it('⭐ código antigo, sem clique, continua valendo (site ainda não atualizado)', () => {
    expect(lerRefDoSite('(ref. SAM-G-21345678901)')).toMatchObject({ ref: 'SAM-G', clique: null });
  });

  it('código de clique malformado não vira código: a ref inteira deixa de casar', () => {
    expect(lerRefDoSite('(ref. SAM-G~CURTO)')).toBeNull();
  });

  it('anúncio CTWA vence: nada de clique do site', () => {
    expect(resolverOrigem('(ref. SAM-G~k7xq9pz2ab)', { ctwaClid: 'x', anuncioId: '1' }).origemClique).toBeNull();
    expect(resolverOrigem('(ref. SAM-G~k7xq9pz2ab)', null).origemClique).toBe('k7xq9pz2ab');
  });
});

describe('validarClique — o que a rota pública aceita', () => {
  it('aceita código + pelo menos um identificador de clique', () => {
    expect(validarClique({ codigo: 'k7xq9pz2ab', gclid: GCLID })).toEqual({ codigo: 'k7xq9pz2ab', gclid: GCLID, gbraid: null, wbraid: null });
  });
  it.each([
    [{ codigo: 'k7xq9pz2ab' }],
    [{ codigo: 'K7XQ9PZ2AB', gclid: GCLID }],
    [{ codigo: 'k7xq9pz2ab', gclid: 'tem espaço e <script>' }],
    [null],
  ])('recusa %j', (corpo) => expect(validarClique(corpo)).toBeNull());

  it('limite por IP corta o excesso e libera na próxima janela', () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(dentroDoLimite('9.9.9.9', t)).toBe(true);
    expect(dentroDoLimite('9.9.9.9', t)).toBe(false);
    expect(dentroDoLimite('9.9.9.9', t + 61_000)).toBe(true);
  });
});

describe('POST /api/clique', () => {
  afterAll(async () => {
    await prisma.cliqueDoSite.deleteMany({ where: { codigo: { in: ['aaaaaaaaa1', 'aaaaaaaaa2'] } } });
  });

  it('⭐ grava o clique vindo de um site da lista (texto, como o sendBeacon manda)', async () => {
    const r = await request(app).post('/api/clique').set('Origin', SITE).set('Content-Type', 'text/plain')
      .send(JSON.stringify({ codigo: 'aaaaaaaaa1', gclid: GCLID }));
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(SITE);
    expect(await prisma.cliqueDoSite.findUnique({ where: { codigo: 'aaaaaaaaa1' } })).toMatchObject({ gclid: GCLID, site: SITE });
  });

  it('⭐ código já registrado NUNCA é trocado por outro gclid', async () => {
    await request(app).post('/api/clique').set('Origin', SITE).set('Content-Type', 'text/plain')
      .send(JSON.stringify({ codigo: 'aaaaaaaaa1', gclid: 'OUTRO_gclid_123456' }));
    expect((await prisma.cliqueDoSite.findUnique({ where: { codigo: 'aaaaaaaaa1' } }))?.gclid).toBe(GCLID);
  });

  it('site fora da lista: 403 e nada gravado', async () => {
    const r = await request(app).post('/api/clique').set('Origin', 'https://evil.example').set('Content-Type', 'text/plain')
      .send(JSON.stringify({ codigo: 'aaaaaaaaa2', gclid: GCLID }));
    expect(r.status).toBe(403);
    expect(await prisma.cliqueDoSite.findUnique({ where: { codigo: 'aaaaaaaaa2' } })).toBeNull();
  });

  it('corpo inválido: 400', async () => {
    const r = await request(app).post('/api/clique').set('Origin', SITE).set('Content-Type', 'text/plain').send('não é json');
    expect(r.status).toBe(400);
  });
});

describe('⭐ lead QUENTE sobe ao Google com o gclid do clique', () => {
  let userId: string;
  const env = { ...process.env };

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { name: 'Clique', email: `clique-${Date.now()}@test.com`, password: 'x', supabaseUserId: `sb-clique-${Date.now()}` },
    });
    userId = u.id;
    await prisma.cliqueDoSite.createMany({ data: [{ codigo: 'bbbbbbbbb1', gclid: GCLID }], skipDuplicates: true });
  });

  afterEach(() => { vi.unstubAllGlobals(); process.env = { ...env }; });

  afterAll(async () => {
    await prisma.whatsappConversation.deleteMany({ where: { userId } });
    await prisma.cliqueDoSite.deleteMany({ where: { codigo: 'bbbbbbbbb1' } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const conversa = (origemClique: string | null, leadPhone: string) => prisma.whatsappConversation.create({
    data: { userId, businessId: 'b-clique', leadPhone, state: 'handoff', origemClique },
  });

  it('cliqueDaConversa: acha o gclid pelo código da conversa', async () => {
    const c = await conversa('bbbbbbbbb1', '5592911110001');
    expect(await cliqueDaConversa(c.id)).toEqual({ gclid: GCLID });
  });

  it('sem código, ou código sem registro: vazio (sobe só pelo telefone, como antes)', async () => {
    expect(await cliqueDaConversa((await conversa(null, '5592911110002')).id)).toEqual({});
    expect(await cliqueDaConversa((await conversa('ccccccccc9', '5592911110003')).id)).toEqual({});
  });

  it('⭐ o corpo enviado ao upload-lead-conversion leva o gclid', async () => {
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const c = await conversa('bbbbbbbbb1', '5592911110004');
    const svc = new WhatsappService(userId, 'b-clique') as unknown as { fireGoogleLeadConversion(p: string, id: string): Promise<void> };
    await svc.fireGoogleLeadConversion('5592911110004', c.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://sb.example/functions/v1/upload-lead-conversion');
    expect(JSON.parse(init.body)).toMatchObject({ phone: '5592911110004', gclid: GCLID });
  });
});
