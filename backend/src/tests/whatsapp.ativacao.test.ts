// Ativação do WhatsApp leads — o que o "Primeiros passos" do app mostra.
// A regra é do servidor (services/whatsapp/ativacao.ts); o app só exibe.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';
import { avaliarAtivacaoWhatsapp, type EntradaDaAtivacao } from '../services/whatsapp/ativacao.js';

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));

const ROTEIRO = [
  { pergunta: 'É para você ou para empresa?', campo: 'tipo' },
  { pergunta: 'Idade de cada pessoa?', campo: 'idades' },
  { pergunta: 'Pretende contratar nos próximos dias?', campo: 'urgencia' },
];

const base: EntradaDaAtivacao = {
  config: {
    enabled: true, handoffContact: '5592999990000', triggerKeyword: '(ref., vi o anúncio e quero uma cotação',
    scriptEnabled: true, scriptSteps: ROTEIRO, questions: [],
  },
  conexao: { estado: 'open' },
  ensaioConcluidoEm: new Date('2026-10-06T12:00:00Z'),
  primeiroQuenteEm: new Date('2026-10-07T12:00:00Z'),
};
const passo = (e: EntradaDaAtivacao, chave: string) => avaliarAtivacaoWhatsapp(e).find((p) => p.chave === chave)!;

describe('avaliarAtivacaoWhatsapp — regra pura', () => {
  it('tudo certo: os quatro passos ok, sem motivo e sem aviso', () => {
    const r = avaliarAtivacaoWhatsapp(base);
    expect(r.map((p) => p.chave)).toEqual(['whatsapp', 'roteiro', 'simulador', 'primeiro_quente']);
    expect(r.every((p) => p.ok && p.motivo === null)).toBe(true);
    expect(passo(base, 'roteiro').aviso).toBeNull();
    expect(passo(base, 'primeiro_quente').em).toBe('2026-10-07T12:00:00.000Z');
  });

  it('⭐ roteiro SEM a pergunta de urgência não passa — e diz por quê', () => {
    const e = { ...base, config: { ...base.config!, scriptSteps: ROTEIRO.filter((p) => p.campo !== 'urgencia') } };
    const p = passo(e, 'roteiro');
    expect(p.ok).toBe(false);
    expect(p.motivo).toContain('urgência');
    expect(p.motivo).toContain('nenhum lead vira QUENTE');
  });

  it('roteiro ligado e vazio, robô desligado e sem vendedor: cada um com o seu motivo', () => {
    expect(passo({ ...base, config: { ...base.config!, scriptSteps: [] } }, 'roteiro').motivo).toContain('mudo');
    expect(passo({ ...base, config: { ...base.config!, enabled: false } }, 'roteiro').motivo).toContain('desligado');
    expect(passo({ ...base, config: { ...base.config!, handoffContact: ' ' } }, 'roteiro').motivo).toContain('vendedor');
    expect(passo({ ...base, config: null }, 'roteiro').motivo).toContain('não foi configurado');
  });

  it('modo IA com perguntas passa, mas avisa que o roteiro fixo é o recomendado', () => {
    const p = passo({ ...base, config: { ...base.config!, scriptEnabled: false, questions: ['Quantas pessoas?'] } }, 'roteiro');
    expect(p.ok).toBe(true);
    expect(p.aviso).toContain('modo IA');
  });

  it('gatilho em branco: passa, com o aviso de quem o robô deixa de atender', () => {
    const p = passo({ ...base, config: { ...base.config!, triggerKeyword: '' } }, 'roteiro');
    expect(p.ok).toBe(true);
    expect(p.aviso).toContain('Sem palavra-gatilho');
  });

  it('WhatsApp: sem conexão, desconectado e erro de consulta têm motivos diferentes', () => {
    expect(passo({ ...base, conexao: null }, 'whatsapp').motivo).toContain('QR code');
    expect(passo({ ...base, conexao: { estado: 'close' } }, 'whatsapp').motivo).toContain('desconectado');
    expect(passo({ ...base, conexao: { estado: 'error' } }, 'whatsapp').motivo).toContain('Não deu para confirmar');
  });

  it('sem ensaio e sem QUENTE: pendentes, com o que fazer', () => {
    const e = { ...base, ensaioConcluidoEm: null, primeiroQuenteEm: null };
    expect(passo(e, 'simulador')).toMatchObject({ ok: false, em: null });
    expect(passo(e, 'simulador').motivo).toContain('simulador');
    expect(passo(e, 'primeiro_quente').ok).toBe(false);
  });
});

// ── Rota ────────────────────────────────────────────────────────────────────
const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'ativacao@test.com' } });
  const res = await request(app).post('/api/auth/register')
    .send({ name: 'Ativação', email: 'ativacao@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.whatsappConversation.deleteMany({ where: { userId } });
  await prisma.whatsappConfig.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'ativacao@test.com' } });
  await prisma.$disconnect();
});

const ativacao = (businessId: string) => request(app).get(`/api/whatsapp/ativacao?businessId=${businessId}`)
  .set('Authorization', `Bearer ${token}`);

describe('GET /api/whatsapp/ativacao', () => {
  it('exige login', async () => {
    expect((await request(app).get('/api/whatsapp/ativacao')).status).toBe(401);
  });

  it('cliente novo: nada configurado, cada passo pendente com o motivo', async () => {
    const r = await ativacao('at-novo');
    expect(r.status).toBe(200);
    expect(r.body.passos.map((p: { ok: boolean }) => p.ok)).toEqual([false, false, false, false]);
    expect(r.body.passos[1].motivo).toContain('não foi configurado');
  });

  it('⭐ ensaio concluído e 1º QUENTE real aparecem; ensaio QUENTE não conta como QUENTE real', async () => {
    await request(app).post('/api/whatsapp/config').set('Authorization', `Bearer ${token}`).send({
      businessId: 'at-1', businessName: 'Corretora', product: 'Plano de saúde', enabled: true,
      handoffContact: '5592999990000', scriptEnabled: true, scriptSteps: ROTEIRO,
      scriptIntro: 'Olá!', scriptClosing: 'Obrigado!',
    });
    // Ensaio concluído e QUENTE (prefixo de ensaio): conta para o simulador, NÃO para o 1º QUENTE.
    await prisma.whatsappConversation.create({
      data: { userId, businessId: 'at-1', leadPhone: 'teste:5592900000001', state: 'handoff', label: 'QUENTE' },
    });
    let r = await ativacao('at-1');
    const p = (chave: string) => r.body.passos.find((x: { chave: string }) => x.chave === chave);
    expect(p('roteiro').ok).toBe(true);
    expect(p('simulador').ok).toBe(true);
    expect(p('primeiro_quente').ok).toBe(false);

    await prisma.whatsappConversation.create({
      data: { userId, businessId: 'at-1', leadPhone: '5592900000002', state: 'handoff', label: 'QUENTE' },
    });
    r = await ativacao('at-1');
    expect(p('primeiro_quente').ok).toBe(true);
    expect(p('primeiro_quente').em).toBeTruthy();
  });

  it('é por negócio: o QUENTE de um negócio não aparece no outro', async () => {
    const r = await ativacao('at-outro');
    expect(r.body.passos.find((x: { chave: string }) => x.chave === 'primeiro_quente').ok).toBe(false);
  });
});
