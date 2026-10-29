// Resposta do vendedor registra o desfecho do lead, e o lembrete de retorno
// (12/10/2026). Ponta a ponta sobre o banco de teste, com a rede mockada.
//
// Cada teste aqui REPROVA o código anterior: até agora a mensagem do vendedor
// caía em podeAbrirConversa e era ignorada em silêncio, e não havia lembrete
// nenhum.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// CAPI: CLASSE de verdade, não `vi.fn().mockImplementation` — mock acessado
// com `new` que não é construtível deixa o TypeError ser engolido pelo
// try/catch da produção e o teste passa sempre (ver CLAUDE.md).
const purchases: Array<{ phone: string; eventId: string; value: number; ctwaClid?: string | null }> = [];
vi.mock('../services/capi.service.js', () => ({
  CapiService: class {
    constructor(public userId: string) {}
    async sendLead() { return { ok: true }; }
    async sendPurchase(input: { phone: string; eventId: string; value: number; ctwaClid?: string | null }) {
      purchases.push(input);
      return { ok: true };
    }
  },
}));

import { WhatsappService } from '../services/whatsapp/whatsapp.service.js';
import { enviarLembretesPendentes } from '../services/whatsapp/resultado.service.js';
import { LogTransport } from '../services/whatsapp/transport.js';

const prisma = new PrismaClient();

const VENDEDOR = '559299990000';
const AVISO_DO_JOAO = '🔔 Novo lead qualificado!\nContato: 559291111001\nTipo: Empresa (CNPJ)';

let userId: string;
const enviadas: Array<{ to: string; text: string }> = [];
let fetchMock: ReturnType<typeof vi.fn>;
// Tabela `campaigns` do Supabase: id da campanha Google → conta. Vazia = não
// sincronizada (a venda cai na conta ativa, com aviso).
let campanhas: Record<string, string> = {};
const ATIVA = '4131358962'; // Tabelasamel
const SITE_NOVO = '7285749588'; // "[Site novo] Planos de Saúde Manaus"

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
  await prisma.user.deleteMany({ where: { email: 'resultado@test.com' } });
  const user = await prisma.user.create({
    data: {
      email: 'resultado@test.com', password: 'x', name: 'Vendedor Teste',
      supabaseUserId: '11111111-1111-1111-1111-111111111111',
    },
  });
  userId = user.id;
  await prisma.whatsappConfig.create({
    data: {
      userId, businessId: 'default', businessName: 'Corretora', product: 'Plano de saúde',
      enabled: true, handoffContact: VENDEDOR, businessHours: 'Seg a Sex, 8h às 18h',
      transport: 'none',
    },
  });
  // Tudo que o bot "envia" passa pelo LogTransport (transport 'none').
  vi.spyOn(LogTransport.prototype, 'sendText').mockImplementation(async (to: string, text: string) => {
    enviadas.push({ to, text });
  });
});

afterAll(async () => {
  await prisma.mCPConnection.deleteMany({ where: { userId } });
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.vendedorPendencia.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  enviadas.length = 0;
  purchases.length = 0;
  campanhas = {};
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.vendedorPendencia.deleteMany({ where: { userId } });
  await prisma.mCPConnection.upsert({
    where: { userId },
    create: { userId, metaAccessToken: 'x', adAccountIds: '[]', connected: true },
    update: {},
  });
  // Supabase + edge function: conexão do Google, insert em closed_sales e o
  // upload da venda. Nenhuma rede de verdade.
  fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes('/rest/v1/google_ads_connections')) {
      return respostaJson([{ active_customer_id: ATIVA, customer_ids: [ATIVA, SITE_NOVO, '3004856946'] }]);
    }
    if (u.includes('/rest/v1/campaigns')) {
      const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)?.[1] ?? '');
      return respostaJson(campanhas[id] ? [{ customer_id: campanhas[id] }] : []);
    }
    if (u.includes('/rest/v1/agency_clients')) {
      return respostaJson([]);
    }
    if (u.includes('/rest/v1/closed_sales')) {
      return respostaJson([{ id: 'venda-uuid-1' }]);
    }
    if (u.includes('/functions/v1/upload-sale-conversion')) {
      return respostaJson({ ok: true });
    }
    throw new Error(`fetch inesperado: ${u} ${init?.method ?? ''}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

function respostaJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

async function leadEmAberto(opts: {
  phone?: string; nome?: string | null; label?: string; handoffDiasAtras?: number;
  origemCanal?: string | null; origemCampanhaId?: string | null; resumo?: string | null;
  ctwaClid?: string | null; origemRef?: string | null;
} = {}) {
  const dias = opts.handoffDiasAtras ?? 0;
  return prisma.whatsappConversation.create({
    data: {
      userId, businessId: 'default',
      leadPhone: opts.phone ?? '559291111001',
      leadNome: opts.nome === undefined ? 'João Silva' : opts.nome,
      state: 'handoff', label: opts.label ?? 'QUENTE',
      summary: opts.resumo ?? 'Tipo: Empresa (CNPJ)\nPessoas: 3',
      handoffEm: new Date(Date.now() - dias * 24 * 3600 * 1000),
      origemCanal: opts.origemCanal ?? 'google',
      origemCampanhaId: opts.origemCampanhaId ?? '21345678901',
      ctwaClid: opts.ctwaClid ?? null,
      origemRef: opts.origemRef ?? null,
    },
  });
}

const doVendedor = (text: string, citacao?: string) =>
  new WhatsappService(userId).handleInbound({ from: VENDEDOR, text, transport: 'log', citacao });

function corpoDoFetch(parte: string): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(parte));
  const body = call?.[1]?.body;
  return body ? JSON.parse(String(body)) : null;
}

describe('"fechou <valor>" registra a venda', () => {
  it('⭐ grava em closed_sales, sobe ao Google e à Meta, e confirma em 1 linha', async () => {
    const conv = await leadEmAberto();
    const r = await doVendedor('fechou 1.200,00', AVISO_DO_JOAO);

    expect(r?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
    expect(enviadas).toEqual([{ to: VENDEDOR, text: '✅ Venda de R$ 1.200,00 registrada para João Silva' }]);

    const venda = corpoDoFetch('/rest/v1/closed_sales');
    expect(venda).toMatchObject({
      user_id: '11111111-1111-1111-1111-111111111111',
      customer_id: '4131358962',
      campaign_id: '21345678901',
      client_name: 'João Silva',
      amount_brl: '1200.00',
    });

    expect(corpoDoFetch('/functions/v1/upload-sale-conversion')).toMatchObject({
      user_id: '11111111-1111-1111-1111-111111111111',
      sale_id: 'venda-uuid-1',
      phone: '559291111001',
    });
    expect(purchases).toEqual([{ phone: '559291111001', eventId: 'venda_venda-uuid-1', value: 1200, ctwaClid: null }]);

    const depois = await prisma.whatsappConversation.findUnique({ where: { id: conv.id } });
    expect(depois).toMatchObject({ resultado: 'venda', vendaValorCents: 120000, vendaSaleId: 'venda-uuid-1' });
  });

  it('⭐ caso real (29/10/2026): a venda de R$ 958,80 com ref ADV leva o código ao AdsGenius, que acha o grupo Adventista', async () => {
    const conv = await leadEmAberto({ origemRef: 'ADV-G' });
    await doVendedor('fechou 958,80', AVISO_DO_JOAO);
    expect(corpoDoFetch('/functions/v1/upload-sale-conversion')).toMatchObject({
      sale_id: 'venda-uuid-1', ref: 'ADV-G', click_date: conv.createdAt.toISOString(),
    });
  });

  it('código do site de conversa que não veio do Google não vai (não aponta grupo do Google)', async () => {
    await leadEmAberto({ origemCanal: 'meta_whatsapp', origemRef: 'ADV-M' });
    await doVendedor('fechou 958,80', AVISO_DO_JOAO);
    expect(corpoDoFetch('/functions/v1/upload-sale-conversion') ?? {}).not.toHaveProperty('ref');
  });

  it('⭐ a MESMA venda não é registrada duas vezes (vendedor repete a mensagem)', async () => {
    await leadEmAberto();
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    const inserts = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/rest/v1/closed_sales')).length;
    expect(inserts()).toBe(1);

    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toContain('já estava registrada');
    expect(inserts()).toBe(1);
    expect(purchases).toHaveLength(1);
  });

  it('⭐ campanha da META não vai para closed_sales.campaign_id (é campo do Google)', async () => {
    await leadEmAberto({ origemCanal: 'meta_whatsapp', origemCampanhaId: '120210000000000' });
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ campaign_id: null });
  });

  it('⭐ venda de lead da campanha da 728 grava na 728, não na conta ativa', async () => {
    campanhas = { '21345678901': SITE_NOVO };
    await leadEmAberto({ origemCampanhaId: '21345678901' });
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ customer_id: SITE_NOVO, campaign_id: '21345678901' });
  });

  it('⭐ campanha não sincronizada: grava na ativa e AVISA no log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await leadEmAberto({ origemCampanhaId: '99999999999' });
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ customer_id: ATIVA });
    expect(aviso.mock.calls.some((c) => String(c[0]).includes('conta ATIVA') && String(c[0]).includes('99999999999'))).toBe(true);
    aviso.mockRestore();
  });

  it('⭐ campanha de conta que NÃO é do usuário (ref forjado): não usa essa conta', async () => {
    campanhas = { '21345678901': '1112223334' };
    await leadEmAberto({ origemCampanhaId: '21345678901' });
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ customer_id: ATIVA });
  });

  it('⭐ "fechou" sem valor PERGUNTA o valor — não grava venda de valor zero', async () => {
    const conv = await leadEmAberto();
    const r = await doVendedor('fechou', AVISO_DO_JOAO);
    expect(r?.reply).toContain('Por quanto?');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('closed_sales'))).toHaveLength(0);
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.resultado).toBeNull();

    // O valor na mensagem seguinte conclui o registro.
    const r2 = await doVendedor('1200');
    expect(r2?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
  });

  it('⭐ à espera do valor, um "2" não vira venda de R$ 2 — pergunta de novo', async () => {
    await leadEmAberto();
    await doVendedor('fechou', AVISO_DO_JOAO);
    const r = await doVendedor('2');
    expect(r).toBeNull();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('closed_sales'))).toHaveLength(0);
  });

  it('⭐ falha ao gravar no AdsGenius: NÃO diz "registrada", DESTRAVA o lead e a repetição grava', async () => {
    const falha = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('google_ads_connections')) return respostaJson([{ active_customer_id: '4131358962' }]);
      if (u.includes('closed_sales')) return { ok: false, status: 500, json: async () => ({}), text: async () => '' } as unknown as Response;
      throw new Error('não deveria enviar conversão sem a venda gravada');
    });
    vi.stubGlobal('fetch', falha);
    const conv = await leadEmAberto();
    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toContain('Não consegui registrar a venda de João Silva agora');
    expect(r?.reply).toContain('Mande de novo');
    expect(r?.reply).not.toContain('registrada');
    expect(purchases).toHaveLength(0);
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.resultado).toBeNull();

    // O AdsGenius volta: a mesma mensagem agora grava (antes: "já estava registrada").
    vi.stubGlobal('fetch', fetchMock);
    const r2 = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r2?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
  });

  it('⭐ sem conta Google: não cai na conta da casa, diz que NÃO entrou na tela — e a Meta recebe mesmo assim', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('google_ads_connections')) return respostaJson([]);
      throw new Error('não deveria gravar venda sem conta resolvida');
    });
    const conv = await leadEmAberto({ ctwaClid: 'ctwa-123' });
    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toBe(
      '✅ Venda de R$ 1.200,00 registrada para João Silva\n'
      + '⚠️ Ficou anotada só aqui no robô — não entrou na tela Vendas (nenhuma conta Google Ads conectada). Enviada à Meta.',
    );
    // Cliente só-Meta (o público do clique-para-WhatsApp): o Purchase sai com
    // id estável da conversa e com o clique do anúncio.
    expect(purchases).toEqual([{ phone: '559291111001', eventId: `venda_conv_${conv.id}`, value: 1200, ctwaClid: 'ctwa-123' }]);
  });

  it('⭐ cliente sem Meta conectada: a Meta não aparece como falha a cada venda', async () => {
    await prisma.mCPConnection.deleteMany({ where: { userId } });
    await leadEmAberto();
    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
    expect(purchases).toHaveLength(0);
  });

  it('⭐ venda de lead do anúncio CTWA sobe à Meta com o clique', async () => {
    await leadEmAberto({ ctwaClid: 'ctwa-999' });
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(purchases[0]).toMatchObject({ eventId: 'venda_venda-uuid-1', ctwaClid: 'ctwa-999' });
  });

  it('⭐ "fechou 2 vidas por 1200" grava R$ 1.200, não R$ 2', async () => {
    await leadEmAberto();
    const r = await doVendedor('fechou 2 vidas por 1200', AVISO_DO_JOAO);
    expect(r?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
  });
});

describe('"perdeu <motivo>" e "em negociação"', () => {
  it('⭐ grava o motivo na categoria e guarda o texto cru', async () => {
    const conv = await leadEmAberto();
    const r = await doVendedor('perdeu preço', AVISO_DO_JOAO);
    expect(r?.reply).toBe('📕 Anotei: João Silva perdido (preço).');
    expect(await prisma.whatsappConversation.findUnique({ where: { id: conv.id } })).toMatchObject({
      resultado: 'perdido', motivoPerda: 'preco', motivoPerdaTexto: 'perdeu preço',
    });
    expect(fetchMock).not.toHaveBeenCalled(); // perda não sobe conversão nenhuma
  });

  it('⭐ lead "em negociação" ainda pode virar venda depois (não fica inalcançável)', async () => {
    const conv = await leadEmAberto({ handoffDiasAtras: 3 });
    await doVendedor('em negociação', AVISO_DO_JOAO);
    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.resultado).toBe('venda');
  });

  it('⭐ "em negociação" rezera o relógio do lembrete em vez de encerrar', async () => {
    const conv = await leadEmAberto({ handoffDiasAtras: 4 });
    await prisma.whatsappConversation.update({ where: { id: conv.id }, data: { lembretesEnviados: 1 } });
    await doVendedor('em negociação', AVISO_DO_JOAO);
    const depois = await prisma.whatsappConversation.findUnique({ where: { id: conv.id } });
    expect(depois?.resultado).toBe('negociando');
    expect(depois?.lembretesEnviados).toBe(0);
    expect(depois!.handoffEm!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('a qual lead, e quem pode falar', () => {
  it('⭐ dois leads abertos sem citação: PERGUNTA, e a resposta "2" conclui', async () => {
    await leadEmAberto({ phone: '559291111001', nome: 'João Silva', handoffDiasAtras: 1 });
    await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza', handoffDiasAtras: 0 });

    const r = await doVendedor('fechou 1200');
    expect(r?.reply).toContain('Qual destes leads?');
    expect(r?.reply).toContain('1) Maria Souza');
    expect(r?.reply).toContain('2) João Silva');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('closed_sales'))).toHaveLength(0);

    const r2 = await doVendedor('2');
    expect(r2?.reply).toBe('✅ Venda de R$ 1.200,00 registrada para João Silva');
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ client_name: 'João Silva' });
  });

  it('⭐ citar o aviso de um lead JÁ vendido não grava a venda no único lead aberto', async () => {
    const joao = await leadEmAberto({ phone: '559291111001', nome: 'João Silva' });
    await prisma.whatsappConversation.update({
      where: { id: joao.id },
      data: { resultado: 'venda', resultadoEm: new Date(), vendaValorCents: 120000 },
    });
    const maria = await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza' });
    const r = await doVendedor('fechou 1200', AVISO_DO_JOAO);
    expect(r?.reply).toBe('Essa venda de R$ 1.200,00 de João Silva já estava registrada — não registrei de novo. 👍');
    expect((await prisma.whatsappConversation.findUnique({ where: { id: maria.id } }))?.resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('⭐ nome que NÃO é do único lead aberto: pergunta, não grava nele', async () => {
    const maria = await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza' });
    const r = await doVendedor('fechou 1200 Pedro');
    expect(r?.reply).toContain('Qual destes leads?');
    expect((await prisma.whatsappConversation.findUnique({ where: { id: maria.id } }))?.resultado).toBeNull();
  });

  it('⭐ esperando o valor do João, citar o aviso da MARIA registra na Maria', async () => {
    const joao = await leadEmAberto({ phone: '559291111001', nome: 'João Silva' });
    const maria = await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza' });
    expect((await doVendedor('fechou', AVISO_DO_JOAO))?.reply).toContain('Por quanto?');
    const r = await doVendedor('fechou 1500', '🔔 Novo lead qualificado!\nContato: 559291111002');
    expect(r?.reply).toBe('✅ Venda de R$ 1.500,00 registrada para Maria Souza');
    expect((await prisma.whatsappConversation.findUnique({ where: { id: maria.id } }))?.resultado).toBe('venda');
    expect((await prisma.whatsappConversation.findUnique({ where: { id: joao.id } }))?.resultado).toBeNull();
  });

  it('⭐ responder citando o LEMBRETE identifica o lead (o lembrete traz o Contato)', async () => {
    await leadEmAberto({ phone: '559291111001', nome: 'João Silva' });
    await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza' });
    const lembrete = 'Lead Maria Souza (empresa, 3 vidas) segue em aberto. Fechou, perdeu ou em negociação?\nContato: 559291111002';
    const r = await doVendedor('perdeu preço', lembrete);
    expect(r?.reply).toBe('📕 Anotei: Maria Souza perdido (preço).');
  });

  it('⭐ nome na própria mensagem dispensa a pergunta', async () => {
    await leadEmAberto({ phone: '559291111001', nome: 'João Silva' });
    await leadEmAberto({ phone: '559291111002', nome: 'Maria Souza' });
    const r = await doVendedor('fechou 980 maria');
    expect(r?.reply).toBe('✅ Venda de R$ 980,00 registrada para Maria Souza');
  });

  it('⭐ mensagem do vendedor que não é desfecho: SILÊNCIO e nenhuma conversa criada para o número dele', async () => {
    await leadEmAberto();
    const r = await doVendedor('bom dia, tudo certo?');
    expect(r).toBeNull();
    expect(enviadas).toHaveLength(0);
    expect(await prisma.whatsappConversation.findFirst({ where: { userId, leadPhone: VENDEDOR } })).toBeNull();
  });

  it('⭐ nada é enviado ao LEAD por este canal, em nenhum caso', async () => {
    await leadEmAberto();
    await doVendedor('fechou 1200', AVISO_DO_JOAO);
    await doVendedor('perdeu preço', AVISO_DO_JOAO);
    expect(enviadas.map((e) => e.to)).toEqual([VENDEDOR, VENDEDOR]);
  });

  it('⭐ número que NÃO é o vendedor segue o caminho de lead (não registra venda)', async () => {
    await leadEmAberto();
    const outro = await new WhatsappService(userId).handleInbound({
      from: '559295555555', text: 'fechou 1200', transport: 'log',
    });
    // Sem gatilho e sem anúncio, continua ignorado em silêncio — como antes.
    expect(outro).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem lead em aberto, diz que não achou em vez de registrar em alguém', async () => {
    const r = await doVendedor('fechou 1200');
    expect(r?.reply).toContain('Não encontrei nenhum lead em aberto');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handoffEm — o marco que o lembrete usa', () => {
  // O bot só fala por roteiro (15/10/2026): a conversa vai ao vendedor quando
  // a última pergunta é respondida. Pergunta sem campo — avança sem IA.
  async function noUltimoPasso(leadPhone: string) {
    await prisma.whatsappConfig.update({
      where: { userId_businessId: { userId, businessId: 'default' } },
      data: { scriptSteps: [{ pergunta: 'Qual o seu nome?', campo: null }] },
    });
    return prisma.whatsappConversation.create({
      data: { userId, businessId: 'default', leadPhone, state: 'qualifying', label: null, botMessages: 1, scriptStep: 0 },
    });
  }

  it('⭐ é gravado quando a conversa vai para o vendedor', async () => {
    const conv = await noUltimoPasso('559291111009');
    await new WhatsappService(userId).handleInbound({ from: '559291111009', text: 'João', transport: 'log' });
    const depois = await prisma.whatsappConversation.findUnique({ where: { id: conv.id } });
    expect(depois?.state).toBe('handoff');
    expect(depois?.handoffEm).not.toBeNull();
  });

  it('⭐ o aviso que o vendedor recebe no handoff ensina a responder', async () => {
    await noUltimoPasso('559291111010');
    await new WhatsappService(userId).handleInbound({ from: '559291111010', text: 'Maria', transport: 'log' });
    const aviso = enviadas.find((e) => e.to === VENDEDOR);
    expect(aviso?.text).toContain('Contato: 559291111010');
    expect(aviso?.text.endsWith(
      '👉 Quando tiver o resultado, responda ESTE aviso: fechou 1200 · perdeu preço · em negociação',
    )).toBe(true);
  });
});

describe('lembrete de retorno (dias 2, 5 e 10)', () => {
  // Terça, 13h UTC = 9h em Manaus — dentro do horário da config.
  const dentroDoHorario = new Date('2026-10-13T13:00:00Z');
  const diasAtras = (n: number) => new Date(dentroDoHorario.getTime() - n * 24 * 3600 * 1000);

  async function leadComHandoffEm(data: Date, extra: Record<string, unknown> = {}) {
    return prisma.whatsappConversation.create({
      data: {
        userId, businessId: 'default', leadPhone: '559291111001', leadNome: 'João Silva',
        state: 'handoff', label: 'QUENTE', handoffEm: data,
        summary: 'Tipo: Empresa (CNPJ)\nPessoas: 3',
        ...extra,
      },
    });
  }

  it('⭐ cobra o vendedor no dia 2, uma vez só, com o lead identificado', async () => {
    const conv = await leadComHandoffEm(diasAtras(2));
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(1);
    expect(enviadas).toEqual([{
      to: VENDEDOR,
      text: 'Lead João Silva (empresa, 3 vidas) segue em aberto. Fechou, perdeu ou em negociação?\nContato: 559291111001',
    }]);
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.lembretesEnviados).toBe(1);

    // Rodar o cron de novo no mesmo dia não repete.
    enviadas.length = 0;
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('⭐ no dia 1 ainda não cobra', async () => {
    await leadComHandoffEm(diasAtras(1));
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);
  });

  it('⭐ 2º lembrete no dia 5, 3º no dia 10, e nada depois', async () => {
    const conv = await leadComHandoffEm(diasAtras(5), { lembretesEnviados: 1 });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(1);

    // Seis dias depois (dia 11 do handoff — o dia 10 cai num domingo, fora do
    // horário), de novo dentro do horário: segunda, 9h em Manaus.
    const dia10 = new Date(dentroDoHorario.getTime() + 6 * 24 * 3600 * 1000);
    expect(await enviarLembretesPendentes(dia10)).toBe(1);
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.lembretesEnviados).toBe(3);

    expect(await enviarLembretesPendentes(new Date(dia10.getTime() + 24 * 3600 * 1000))).toBe(0);
  });

  it('⭐ lembretes ATRASADOS não saem em fila: um só, já o mais adiantado', async () => {
    // Bot ficou fora do ar: handoff há 11 dias e nenhum lembrete enviado.
    const conv = await leadComHandoffEm(diasAtras(11));
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(1);
    expect((await prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))?.lembretesEnviados).toBe(3);
    // Uma hora depois não sai mais nada (antes: o 2º e o 3º em horas seguidas).
    expect(await enviarLembretesPendentes(new Date(dentroDoHorario.getTime() + 3600 * 1000))).toBe(0);
    expect(enviadas).toHaveLength(1);
  });

  it('⭐ conversas que nunca saem não tomam o lugar das devidas (varredura paginada)', async () => {
    // 500 leads devidos de um negócio com o bot DESLIGADO, criados antes...
    await prisma.whatsappConfig.upsert({
      where: { userId_businessId: { userId, businessId: 'desligado' } },
      create: { userId, businessId: 'desligado', businessName: 'Off', product: 'x', enabled: false, handoffContact: VENDEDOR },
      update: { enabled: false },
    });
    await prisma.whatsappConversation.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        userId, businessId: 'desligado', leadPhone: `55929000${String(i).padStart(4, '0')}`,
        state: 'handoff', label: 'QUENTE', handoffEm: diasAtras(3),
      })),
    });
    // ...e um devido do negócio ligado, criado depois.
    await leadComHandoffEm(diasAtras(3));
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(1);
    await prisma.whatsappConfig.deleteMany({ where: { userId, businessId: 'desligado' } });
  });

  it('⭐ para quando há desfecho — e segue para quem está "em negociação"', async () => {
    await leadComHandoffEm(diasAtras(10), { resultado: 'venda', leadPhone: '559291111002' });
    await leadComHandoffEm(diasAtras(10), { resultado: 'perdido', leadPhone: '559291111003' });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);

    await leadComHandoffEm(diasAtras(2), { resultado: 'negociando', leadPhone: '559291111004' });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(1);
  });

  it('⭐ lead FRIO não gera cobrança', async () => {
    await leadComHandoffEm(diasAtras(10), { label: 'FRIO' });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);
  });

  it('⭐ fora do horário de atendimento, nada sai (nem no domingo)', async () => {
    await leadComHandoffEm(diasAtras(3));
    // 2026-10-13T02:00:00Z = 22h de segunda em Manaus.
    expect(await enviarLembretesPendentes(new Date('2026-10-13T02:00:00Z'))).toBe(0);
    // 2026-10-18 é domingo, 15h UTC = 11h em Manaus.
    expect(await enviarLembretesPendentes(new Date('2026-10-18T15:00:00Z'))).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('⭐ conversa de ensaio do simulador nunca gera lembrete', async () => {
    await leadComHandoffEm(diasAtras(10), { leadPhone: 'teste:559291111001' });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);
  });

  it('⭐ bot desligado não cobra ninguém', async () => {
    await leadComHandoffEm(diasAtras(2));
    await prisma.whatsappConfig.update({
      where: { userId_businessId: { userId, businessId: 'default' } }, data: { enabled: false },
    });
    expect(await enviarLembretesPendentes(dentroDoHorario)).toBe(0);
    await prisma.whatsappConfig.update({
      where: { userId_businessId: { userId, businessId: 'default' } }, data: { enabled: true },
    });
  });
});

// O que foi vendido (23/10/2026). Os ⭐ reprovam o código anterior: o produto
// não chegava a closed_sales, e "hapvida individual" com um lead aberto só
// virava a pergunta "qual destes leads?".
describe('"fechou <valor> <produto>" grava também o que foi vendido', () => {
  it('⭐ grava o produto em closed_sales e confirma com ele — sem perguntar qual lead', async () => {
    await leadEmAberto();
    const r = await doVendedor('fechou 958,80 hapvida individual');

    expect(r?.reply).toBe('✅ Venda de R$ 958,80 (Hapvida individual) registrada para João Silva');
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({
      amount_brl: '958.80', product: 'Hapvida individual', client_name: 'João Silva',
    });
  });

  it('⭐ o produto NÃO vai ao Google nem à Meta', async () => {
    await leadEmAberto();
    await doVendedor('fechou 958,80 hapvida individual', AVISO_DO_JOAO);
    expect(JSON.stringify(corpoDoFetch('/functions/v1/upload-sale-conversion'))).not.toMatch(/hapvida|product/i);
    expect(JSON.stringify(purchases)).not.toMatch(/hapvida|product/i);
    expect(purchases).toHaveLength(1);
  });

  it('"fechou 958,80" sem produto não manda a coluna product (funciona antes da migration)', async () => {
    await leadEmAberto();
    const r = await doVendedor('fechou 958,80', AVISO_DO_JOAO);
    expect(r?.reply).toBe('✅ Venda de R$ 958,80 registrada para João Silva');
    expect(corpoDoFetch('/rest/v1/closed_sales')).not.toHaveProperty('product');
  });

  it('⭐ produto dito antes do valor não se perde: "fechou hapvida individual" → "958,80"', async () => {
    await leadEmAberto();
    expect((await doVendedor('fechou hapvida individual', AVISO_DO_JOAO))?.reply).toContain('Por quanto?');
    const r = await doVendedor('958,80');
    expect(r?.reply).toBe('✅ Venda de R$ 958,80 (Hapvida individual) registrada para João Silva');
    expect(corpoDoFetch('/rest/v1/closed_sales')).toMatchObject({ amount_brl: '958.80', product: 'Hapvida individual' });
  });

  it('⭐ banco sem a coluna product: grava a venda sem o produto em vez de perdê-la', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('/rest/v1/closed_sales') && String(init?.body ?? '').includes('"product"')) {
        return {
          ok: false, status: 400,
          json: async () => ({ code: 'PGRST204', message: "Could not find the 'product' column of 'closed_sales' in the schema cache" }),
          text: async () => '',
        } as unknown as Response;
      }
      return original(url, init);
    });
    const conv = await leadEmAberto();
    const r = await doVendedor('fechou 958,80 hapvida individual', AVISO_DO_JOAO);

    const inserts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/rest/v1/closed_sales'));
    expect(inserts).toHaveLength(2);
    expect(JSON.parse(String(inserts[1][1]?.body))).not.toHaveProperty('product');
    expect(r?.reply).toContain('✅ Venda de R$ 958,80');
    const depois = await prisma.whatsappConversation.findUnique({ where: { id: conv.id } });
    expect(depois).toMatchObject({ resultado: 'venda', vendaSaleId: 'venda-uuid-1' });
  });

  it('outra recusa do banco NÃO é regravada sem produto: destrava o lead como antes', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('/rest/v1/closed_sales')) {
        return { ok: false, status: 500, json: async () => ({ code: 'XX000', message: 'erro' }), text: async () => '' } as unknown as Response;
      }
      return original(url, init);
    });
    await leadEmAberto();
    const r = await doVendedor('fechou 958,80 hapvida individual', AVISO_DO_JOAO);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/rest/v1/closed_sales'))).toHaveLength(1);
    expect(r?.reply).toContain('Não consegui registrar');
  });
});
