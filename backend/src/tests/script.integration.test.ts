// Modo ROTEIRO FIXO — o caminho INTEIRO, da mensagem do lead até o handoff.
//
// O teste que carrega o peso é um só: com `scriptEnabled`, o motor generativo
// (`nextReply`) NUNCA é chamado e cada texto que sai é byte a byte o que o
// cliente escreveu na config. Foi exatamente isso que quebrou ao vivo em
// 24/09/2026 — o bot "melhorava" as perguntas e conversava fora de contexto.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// O motor generativo. Se ele for chamado no modo roteiro, é regressão.
const mockNextReply = vi.fn().mockResolvedValue({
  reply: 'Texto INVENTADO pela IA — nunca deveria chegar ao lead no modo roteiro.',
  state: 'qualifying',
  done: false,
});
vi.mock('../services/whatsapp/qualification.service.js', () => ({
  nextReply: (...args: unknown[]) => mockNextReply(...args),
}));

// A leitura de campo é a ÚNICA chamada de IA do modo roteiro. Mockamos só ela
// e deixamos as funções puras reais — são elas que definem o comportamento que
// este arquivo está testando.
const mockLerResposta = vi.fn();
vi.mock('../services/whatsapp/script.service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/whatsapp/script.service.js')>();
  return { ...real, lerResposta: (...args: unknown[]) => mockLerResposta(...args) };
});

// A pergunta à Meta "qual a campanha deste anúncio?" (Graph API) — sem rede.
const mockCampanhaDoAnuncio = vi.fn(async () => '120210000000777');
vi.mock('../services/whatsapp/origem.meta.js', () => ({
  resolverCampanhaDoAnuncio: (...a: unknown[]) => mockCampanhaDoAnuncio(...(a as [])),
}));

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));

// ⚠️ Precisa ser uma CLASSE de verdade: o serviço faz `new CapiService(...)`.
// Um `vi.fn().mockImplementation(() => ({...}))` não é construtível, estoura
// dentro do try/catch do fireCapiLead e some — deixando um
// `expect(...).not.toHaveBeenCalled()` que passa por acidente, sempre.
const mockSendLead = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../services/capi.service.js', () => ({
  CapiService: class {
    sendLead(...args: unknown[]) { return mockSendLead(...args); }
  },
}));

// ─── Setup ──────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;

// O roteiro EXATO pedido pelo Luiz em 24/09/2026. Acentos, barras e
// parênteses fazem parte do contrato: se o teste passar com o texto
// "arrumado", ele não está protegendo nada.
const INTRO = 'Olá, meu nome é Luiz Cláudio Brito, corretor de seguros e planos de saúde.';
const P1 = 'É para você/sua família ou para uma empresa (CNPJ)?';
const P2 = 'Quantas pessoas vão entrar no plano?';
const P3 = 'Qual a idade de cada uma? (se for empresa: quantos funcionários?)';
const P4 = 'Já tem plano hoje? Qual?';
const P5 = 'Pretende contratar nos próximos dias ou está só pesquisando?';
const FECHAMENTO = 'Obrigado! Já passei seus dados para o corretor, ele vai te chamar por aqui.';

const PASSOS = [
  { pergunta: P1, campo: 'tipo' },
  { pergunta: P2, campo: 'vidas' },
  { pergunta: P3, campo: 'idades' },
  { pergunta: P4, campo: 'plano_atual' },
  { pergunta: P5, campo: 'urgencia' },
];

async function configRoteiro(businessId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/whatsapp/config')
    .set('Authorization', `Bearer ${token}`)
    .send({
      businessName: 'Corretora Teste',
      product: 'Plano de saúde',
      enabled: true,
      businessId,
      handoffContact: '+551199999999',
      scriptEnabled: true,
      scriptIntro: INTRO,
      scriptClosing: FECHAMENTO,
      scriptSteps: PASSOS,
      ...overrides,
    });
}

function enviar(businessId: string, from: string, text: string) {
  return request(app)
    .post('/api/whatsapp/simulate')
    .set('Authorization', `Bearer ${token}`)
    .send({ businessId, from, text });
}

async function lerConversa(businessId: string, leadPhone: string) {
  return prisma.whatsappConversation.findUnique({
    where: { userId_businessId_leadPhone: { userId, businessId, leadPhone } },
  });
}

function falasDoBot(conv: { history: unknown } | null): string[] {
  const h = ((conv?.history ?? []) as { role: string; text: string }[]);
  return h.filter((x) => x.role === 'assistant').map((x) => x.text);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'roteiro@test.com' } });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Roteiro Test', email: 'roteiro@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappCharge.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'roteiro@test.com' } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockNextReply.mockClear();
  mockLerResposta.mockReset();
  mockSendLead.mockClear();
  mockCampanhaDoAnuncio.mockClear();
});

// Lê o campo como a IA leria, mas sem IA: devolve o valor combinado por campo.
function respostasPorCampo(mapa: Record<string, unknown>) {
  mockLerResposta.mockImplementation(async (_uid: string, passo: { campo: string }) =>
    (passo.campo in mapa ? mapa[passo.campo] : null));
}

describe('⭐ Roteiro fixo: quem fala é o roteiro, a IA só lê', () => {
  it('a primeira mensagem devolve a apresentação e a 1ª pergunta — LITERAIS, sem IA generativa', async () => {
    await configRoteiro('rot-a');
    await enviar('rot-a', '5511900010001', 'oi');

    const conv = await lerConversa('rot-a', '5511900010001');
    expect(falasDoBot(conv)).toEqual([INTRO, P1]);
    expect(mockNextReply).not.toHaveBeenCalled();
    expect(mockLerResposta).not.toHaveBeenCalled(); // nada a ler ainda
    expect(conv?.scriptStep).toBe(0);
  });

  it('⭐ o roteiro inteiro sai palavra por palavra e a IA generativa nunca é chamada', async () => {
    await configRoteiro('rot-b');
    respostasPorCampo({
      tipo: 'pf', vidas: 2, idades: [34, 31], plano_atual: 'nenhum', urgencia: 'contratar',
    });

    await enviar('rot-b', '5511900010002', 'oi');
    for (const resposta of ['é pra mim', 'somos 2', '34 e 31', 'não tenho', 'quero contratar']) {
      await enviar('rot-b', '5511900010002', resposta);
    }

    const conv = await lerConversa('rot-b', '5511900010002');
    // ⭐ A frase de encerramento sai JUNTO com a última resposta — quem acabou
    // de responder tudo não pode ficar no vácuo esperando.
    expect(falasDoBot(conv)).toEqual([INTRO, P1, P2, P3, P4, P5, FECHAMENTO]);
    expect(mockNextReply).not.toHaveBeenCalled();
    expect(conv?.state).toBe('handoff');
    // ⭐ QUENTE sobe a conversão. Esta asserção também é o que prova que o mock
    // do CAPI está LIGADO — sem ela, o `not.toHaveBeenCalled()` do teste FRIO
    // passaria por acidente mesmo com a trava de rótulo removida.
    expect(mockSendLead).toHaveBeenCalledTimes(1);
  });

  it('no fim: resumo para o vendedor, rótulo QUENTE e conversão disparada', async () => {
    // A conversão sobe DENTRO do teste anterior (o roteiro termina lá), então
    // aqui só o que sobrevive no banco pode ser afirmado — ver o teste do FRIO
    // logo abaixo, que dispara e confere o CAPI na mesma execução.
    const conv = await lerConversa('rot-b', '5511900010002');
    expect(conv?.label).toBe('QUENTE');
    expect(conv?.summary).toContain('Tipo: Pessoa física/família');
    expect(conv?.summary).toContain('Idades: 34, 31');
    expect(conv?.summary).toContain('Intenção: quer contratar nos próximos dias');
    expect(conv?.scriptData).toMatchObject({ tipo: 'pf', vidas: 2, idades: [34, 31] });
  });

  it('⭐ "só pesquisando" termina o roteiro igual, mas como FRIO — sem subir conversão', async () => {
    await configRoteiro('rot-frio');
    respostasPorCampo({
      tipo: 'pf', vidas: 1, idades: [40], plano_atual: 'Hapvida', urgencia: 'pesquisando',
    });

    await enviar('rot-frio', '5511900010003', 'oi');
    for (const r of ['pra mim', '1', '40', 'hapvida', 'só olhando']) {
      await enviar('rot-frio', '5511900010003', r);
    }

    const conv = await lerConversa('rot-frio', '5511900010003');
    expect(conv?.state).toBe('handoff');
    expect(conv?.label).toBe('FRIO');
    expect(conv?.summary).toContain('Intenção: só pesquisando');
    expect(mockSendLead).not.toHaveBeenCalled(); // FRIO não vira conversão
  });
});

describe('Resposta fora do roteiro: repete UMA vez, depois segue', () => {
  it('⭐ pergunta repetida é a MESMA string — e só se repete uma vez', async () => {
    await configRoteiro('rot-rep');
    respostasPorCampo({}); // a IA não consegue ler NADA

    await enviar('rot-rep', '5511900010004', 'oi');
    await enviar('rot-rep', '5511900010004', 'vocês ficam onde?'); // fugiu → repete P1
    let conv = await lerConversa('rot-rep', '5511900010004');
    expect(falasDoBot(conv)).toEqual([INTRO, P1, P1]);
    expect(conv?.scriptRetried).toBe(true);
    expect(conv?.scriptStep).toBe(0);

    await enviar('rot-rep', '5511900010004', 'mas qual o preço?'); // fugiu de novo → avança
    conv = await lerConversa('rot-rep', '5511900010004');
    expect(falasDoBot(conv)).toEqual([INTRO, P1, P1, P2]);
    expect(conv?.scriptRetried).toBe(false);
    expect(conv?.scriptStep).toBe(1);
  });

  it('⭐ o que ele não respondeu vira `null` gravado — o vendedor precisa VER a lacuna', async () => {
    const conv = await lerConversa('rot-rep', '5511900010004');
    expect(conv?.scriptData).toEqual({ tipo: null });
  });

  it('quem não respondeu NADA chega ao fim como FRIO, não como QUENTE', async () => {
    // Continua a conversa de rot-rep fugindo de todas as perguntas. Paramos no
    // handoff: passar dali já é o teste da frase de encerramento, outro caso.
    let conv = await lerConversa('rot-rep', '5511900010004');
    for (let i = 0; i < 12 && conv?.state !== 'handoff'; i++) {
      await enviar('rot-rep', '5511900010004', 'não quero dizer');
      conv = await lerConversa('rot-rep', '5511900010004');
    }
    expect(conv?.state).toBe('handoff');
    expect(conv?.label).toBe('FRIO');
    expect(conv?.summary).toContain('Pessoas: não respondeu');
    expect(mockNextReply).not.toHaveBeenCalled();
  });
});

describe('Depois do encerramento: silêncio de verdade', () => {
  it('⭐ a frase final sai UMA vez só e o bot não diz mais nada, nunca', async () => {
    const antes = falasDoBot(await lerConversa('rot-b', '5511900010002'));
    expect(antes.at(-1)).toBe(FECHAMENTO); // já saiu no fim do roteiro

    // Três mensagens depois — inclusive uma pergunta direta, que é o que mais
    // tentaria o motor generativo a responder.
    for (const t of ['obrigado!', 'e aí, alguém aí?', 'quanto fica o plano?']) {
      const res = await enviar('rot-b', '5511900010002', t);
      expect(res.body.reply).toBeUndefined();
    }

    const conv = await lerConversa('rot-b', '5511900010002');
    expect(falasDoBot(conv)).toEqual(antes); // nenhuma fala nova
    expect(conv?.state).toBe('handoff');
    expect(mockNextReply).not.toHaveBeenCalled();
  });
});

describe('Config: o roteiro não pode sumir sozinho', () => {
  it('⭐ salvar a persona pelo painel de hoje NÃO desliga o roteiro', async () => {
    await configRoteiro('rot-cfg');

    // O painel atual não conhece os campos do roteiro — manda só a persona.
    await request(app)
      .post('/api/whatsapp/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'rot-cfg', businessName: 'Corretora Teste', product: 'Plano de saúde', enabled: true });

    const cfg = await prisma.whatsappConfig.findUnique({
      where: { userId_businessId: { userId, businessId: 'rot-cfg' } },
    });
    expect(cfg?.scriptEnabled).toBe(true);
    expect(cfg?.scriptIntro).toBe(INTRO);
    expect(cfg?.scriptClosing).toBe(FECHAMENTO);
    expect((cfg?.scriptSteps as unknown[])).toHaveLength(5);
  });

  it('roteiro ligado e VAZIO deixa o bot mudo — não cai no motor generativo', async () => {
    await configRoteiro('rot-vazio', { scriptSteps: [] });

    // `[]` limpa de verdade: `??` só cai para o valor antigo em null/undefined,
    // então mandar lista vazia é uma ordem explícita, não uma omissão.
    const cfg = await prisma.whatsappConfig.findUnique({
      where: { userId_businessId: { userId, businessId: 'rot-vazio' } },
    });
    expect(cfg?.scriptSteps).toEqual([]);

    const res = await enviar('rot-vazio', '5511900010005', 'oi');
    expect(res.body.reply).toBeUndefined();
    expect(mockNextReply).not.toHaveBeenCalled();
  });
});

// ─── Origem da conversa (01/10/2026) ────────────────────────────────────────
// Até aqui a conversa não guardava de onde veio, e o click id do anúncio
// "clique para o WhatsApp" — que a Meta manda SÓ na 1ª mensagem — se perdia
// antes do Lead QUENTE sair para a CAPI, mensagens depois.
describe('⭐ Origem da conversa', () => {
  const RESPOSTAS = ['é pra mim', 'somos 2', '34 e 31', 'não tenho', 'quero contratar'];
  const QUENTE = { tipo: 'pf', vidas: 2, idades: [34, 31], plano_atual: 'nenhum', urgencia: 'contratar' };

  it('⭐ o webhook da Evolution lê o referral do anúncio CTWA', async () => {
    const { EvolutionTransport } = await import('../services/whatsapp/transport.js');
    const t = new EvolutionTransport('http://x', 'k', 'i');
    const msg = t.parseInbound({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5511900020001@s.whatsapp.net', fromMe: false },
        message: {
          extendedTextMessage: {
            text: 'Olá! Quero mais informações.',
            contextInfo: { externalAdReply: { ctwaClid: 'CLID-REAL', sourceId: '1202', sourceType: 'ad' } },
          },
        },
      },
    });
    expect(msg?.ctwaClid).toBe('CLID-REAL');
    expect(msg?.anuncio).toEqual({ ctwaClid: 'CLID-REAL', anuncioId: '1202' });
  });

  it('⭐ o Lead QUENTE sai com o ctwaClid da 1ª mensagem, mesmo vindo mensagens depois', async () => {
    await configRoteiro('orig-ctwa');
    respostasPorCampo(QUENTE);
    const { WhatsappService } = await import('../services/whatsapp/whatsapp.service.js');
    const svc = new WhatsappService(userId, 'orig-ctwa');

    // 1ª mensagem: veio do anúncio (é a única que traz o referral).
    await svc.handleInbound({
      from: '5511900020002', text: 'Olá! Quero mais informações.', transport: 'log',
      ctwaClid: 'CLID-1', anuncio: { ctwaClid: 'CLID-1', anuncioId: 'AD-9' },
    });
    // As seguintes chegam SEM referral, como na vida real.
    for (const r of RESPOSTAS) await enviar('orig-ctwa', '5511900020002', r);

    const conv = await lerConversa('orig-ctwa', '5511900020002');
    expect(conv?.origemCanal).toBe('meta_whatsapp');
    expect(conv?.origemAnuncioId).toBe('AD-9');
    // ⭐ A campanha do anúncio é resolvida na Meta em segundo plano e gravada.
    expect(mockCampanhaDoAnuncio).toHaveBeenCalledWith(userId, 'AD-9');
    expect(conv?.origemCampanhaId).toBe('120210000000777');
    expect(mockSendLead).toHaveBeenCalledTimes(1);
    expect(mockSendLead.mock.calls[0][0]).toMatchObject({ ctwaClid: 'CLID-1' });
  });

  it('⭐ código do site na 1ª mensagem vira origem, e o vendedor fica sabendo', async () => {
    await configRoteiro('orig-site');
    respostasPorCampo(QUENTE);
    const { LogTransport } = await import('../services/whatsapp/transport.js');
    const enviados = vi.spyOn(LogTransport.prototype, 'sendText');

    await enviar('orig-site', '5511900020003', 'Olá! Quero uma cotação do plano Hapvida.\n\n(ref. HAP-G-21345678901)');
    for (const r of RESPOSTAS) await enviar('orig-site', '5511900020003', r);

    const conv = await lerConversa('orig-site', '5511900020003');
    expect(conv?.origemCanal).toBe('google');
    expect(conv?.origemRef).toBe('HAP-G');
    expect(conv?.origemCampanhaId).toBe('21345678901'); // ⭐ campanha do código do site
    expect(conv?.ctwaClid).toBeNull();
    expect(mockCampanhaDoAnuncio).not.toHaveBeenCalledWith(userId, expect.anything()); // site não pergunta à Meta
    const paraVendedor = enviados.mock.calls.filter(([to]) => to === '+551199999999').map(([, txt]) => txt);
    expect(paraVendedor.join('\n')).toContain('Origem: anúncio do Google, pelo site (ref. HAP-G)');
    enviados.mockRestore();
  });

  it('a origem nunca é sobrescrita por mensagem posterior', async () => {
    await configRoteiro('orig-fixa');
    respostasPorCampo({});
    await enviar('orig-fixa', '5511900020004', 'oi (ref. SAM-M)');
    await enviar('orig-fixa', '5511900020004', 'e agora (ref. HAP-G)');
    const conv = await lerConversa('orig-fixa', '5511900020004');
    expect(conv?.origemRef).toBe('SAM-M');
    expect(conv?.origemCanal).toBe('meta');
  });
});

// Site multimarcas (01/10/2026). O roteiro não pergunta operadora — antes
// disto, todo lead recebia a cotação do leque padrão (Samel), inclusive quem
// clicou em "Cotar Hapvida". E SulAmérica/Bradesco, que o Luiz vende sem
// tabela no Cote+, não podem receber promessa de cotação nem "não trabalho com".
describe('⭐ Roteiro + cotação: a página do site decide a operadora', () => {
  const COTE_URL = 'https://cote.test/functions/v1/cotacao-externa';
  const RESPOSTAS = ['é pra mim', 'somos 2', '34 e 31', 'não tenho', 'quero contratar'];
  const QUENTE = { tipo: 'pf', vidas: 2, idades: [34, 31], plano_atual: 'nenhum', urgencia: 'contratar' };
  const fetchOriginal = globalThis.fetch;
  const pedidosAoCote: { operadoras: string[] }[] = [];

  beforeAll(() => {
    process.env.COTE_QUOTE_USER = 'roteiro@test.com';
    process.env.COTE_QUOTE_URL = COTE_URL;
    process.env.COTE_QUOTE_KEY = 'chave-teste';
    process.env.COTE_QUOTE_OPERATOR = 'samel';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === COTE_URL) {
        const corpo = JSON.parse(String(init?.body));
        pedidosAoCote.push(corpo);
        return new Response(JSON.stringify({ ok: true, texto: `Cotação ${corpo.operadoras.join('+')}: R$ 500`, planos: [{}] }), { status: 200 });
      }
      return fetchOriginal(url, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.COTE_QUOTE_USER;
    delete process.env.COTE_QUOTE_URL;
    delete process.env.COTE_QUOTE_KEY;
    delete process.env.COTE_QUOTE_OPERATOR;
  });

  beforeEach(() => { pedidosAoCote.length = 0; });

  async function rodar(businessId: string, fone: string, primeira: string) {
    await configRoteiro(businessId);
    respostasPorCampo(QUENTE);
    await enviar(businessId, fone, primeira);
    for (const r of RESPOSTAS) await enviar(businessId, fone, r);
    return lerConversa(businessId, fone);
  }

  it('⭐ veio da página da Hapvida: cota Hapvida, não o leque padrão', async () => {
    const conv = await rodar('cot-hap', '5511900030001', 'Olá! Quero uma cotação do plano Hapvida.\n\n(ref. HAP-G)');
    expect(pedidosAoCote).toHaveLength(1);
    expect(pedidosAoCote[0].operadoras).toEqual(['hapvida']);
    expect(falasDoBot(conv)).toContain('Cotação hapvida: R$ 500');
  });

  it('página do plano adventista: cota Proasa e Adventista (Plural) juntas', async () => {
    await rodar('cot-adv', '5511900030002', 'Quero o plano adventista (ref. ADV-G)');
    expect(pedidosAoCote[0].operadoras).toEqual(['proasa', 'adventista']);
  });

  it('⭐ página da Bradesco: não chama o Cote+, não promete cotação e o vendedor sabe por quê', async () => {
    const { LogTransport } = await import('../services/whatsapp/transport.js');
    const enviados = vi.spyOn(LogTransport.prototype, 'sendText');
    const conv = await rodar('cot-bra', '5511900030003', 'Olá! Quero uma cotação do plano Bradesco Saúde.\n\n(ref. BRA-G)');
    expect(pedidosAoCote).toHaveLength(0);
    const falas = falasDoBot(conv).join('\n');
    expect(falas).not.toContain('Vou te passar uma cotação agora');
    expect(falas).not.toMatch(/não trabalho com/i);
    expect(falas).toContain(FECHAMENTO);
    const paraVendedor = enviados.mock.calls.filter(([to]) => to === '+551199999999').map(([, txt]) => txt).join('\n');
    expect(paraVendedor).toContain('Veio para Bradesco Saúde: sem tabela no Cote+, a cotação fica com você.');
    expect(paraVendedor).toContain('34, 31');
    enviados.mockRestore();
  });

  it('página de hospital (Santa Júlia) vai ao vendedor, como SulAmérica/Bradesco', async () => {
    await rodar('cot-sju', '5511900030004', 'Quero plano com atendimento no Hospital Santa Júlia (ref. SJU-G)');
    expect(pedidosAoCote).toHaveLength(0);
  });

  it('sem página (anúncio Meta, conversa direta): leque padrão, como sempre', async () => {
    await rodar('cot-pad', '5511900030005', 'oi, quero cotação');
    expect(pedidosAoCote[0].operadoras).toEqual(['samel']);
  });
});
