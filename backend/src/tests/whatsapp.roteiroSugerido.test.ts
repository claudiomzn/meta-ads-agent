// "Criar roteiro com IA para o meu negócio" (15/10/2026). A IA escreve só o
// RASCUNHO; o texto é conferido antes de voltar à tela porque vai palavra por
// palavra ao lead. Luiz: "cuidado, vamos trabalhar com muitos outros ramos".
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';

// ⚠️ CLASSE de verdade: o serviço faz `new Anthropic(...)`.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: (...a: unknown[]) => mockCreate(...a) }; },
}));
vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));

import authRoutes from '../routes/auth.routes.js';
import whatsappRoutes from '../routes/whatsapp.routes.js';
import { ehPlanoDeSaude, promptDoRoteiro, validarRoteiroSugerido } from '../services/whatsapp/roteiro.sugerido.js';
import { PERGUNTA_DE_URGENCIA } from '../services/whatsapp/roteiro.efetivo.js';

const IMOBILIARIA = {
  apresentacao: 'Olá! Aqui é da Imobiliária Rio Negro, obrigado pelo contato.',
  perguntas: [
    { pergunta: 'Você procura imóvel para comprar ou para alugar?', campo: null },
    { pergunta: 'Em qual bairro de Manaus?', campo: null },
    { pergunta: 'Quantos quartos você precisa?', campo: 'vidas' },
    { pergunta: 'Pretende fechar nos próximos dias ou está só pesquisando?', campo: 'urgencia' },
  ],
  encerramento: 'Obrigado! Um consultor vai te responder por aqui em instantes.',
};

describe('o rascunho da IA é conferido antes de voltar à tela', () => {
  it('⭐ outro ramo: mantém o texto e só aceita o campo de urgência', () => {
    const r = validarRoteiroSugerido(IMOBILIARIA, 'imóveis para venda e aluguel');
    expect(r.intro).toBe(IMOBILIARIA.apresentacao);
    expect(r.passos.map((p) => p.pergunta)).toEqual(IMOBILIARIA.perguntas.map((p) => p.pergunta));
    // "vidas" é de plano de saúde: fora dele não há cotação para alimentar.
    expect(r.passos.map((p) => p.campo)).toEqual([null, null, null, 'urgencia']);
  });

  it('⭐ sem pergunta de urgência, ela entra no fim — senão todo lead sai FRIO', () => {
    const r = validarRoteiroSugerido({ ...IMOBILIARIA, perguntas: IMOBILIARIA.perguntas.slice(0, 2) }, 'imóveis');
    expect(r.passos.at(-1)).toEqual({ pergunta: PERGUNTA_DE_URGENCIA, campo: 'urgencia' });
  });

  it('⭐ preço não passa: pergunta com R$ é descartada, apresentação com R$ reprova tudo', () => {
    const comPreco = { ...IMOBILIARIA, perguntas: [{ pergunta: 'Aluguel a partir de R$ 900, pode ser?', campo: null }, ...IMOBILIARIA.perguntas] };
    expect(validarRoteiroSugerido(comPreco, 'imóveis').passos.some((p) => p.pergunta.includes('R$'))).toBe(false);
    expect(() => validarRoteiroSugerido({ ...IMOBILIARIA, apresentacao: 'Planos a partir de R$ 99!' }, 'imóveis')).toThrow();
  });

  it('plano de saúde: os campos que alimentam a cotação são aceitos', () => {
    const r = validarRoteiroSugerido({
      apresentacao: 'Olá!', encerramento: 'Obrigado!',
      perguntas: [{ pergunta: 'Qual a idade de cada pessoa?', campo: 'idades' }, { pergunta: 'Contrata já?', campo: 'urgencia' }],
    }, 'Planos de saúde Samel');
    expect(r.passos.map((p) => p.campo)).toEqual(['idades', 'urgencia']);
    expect(ehPlanoDeSaude('Planos de saúde Samel')).toBe(true);
    expect(ehPlanoDeSaude('imóveis')).toBe(false);
  });

  it('o prompt só oferece os campos de plano de saúde a quem vende plano de saúde', () => {
    expect(promptDoRoteiro({ businessName: 'X', product: 'imóveis' })).not.toContain('"idades"');
    expect(promptDoRoteiro({ businessName: 'X', product: 'plano de saúde' })).toContain('"idades"');
  });

  it('resposta sem apresentação ou sem encerramento não é aproveitada', () => {
    expect(() => validarRoteiroSugerido({ ...IMOBILIARIA, apresentacao: '' }, 'imóveis')).toThrow();
    expect(() => validarRoteiroSugerido({ ...IMOBILIARIA, encerramento: '' }, 'imóveis')).toThrow();
  });
});

describe('POST /api/whatsapp/roteiro/sugerir', () => {
  const prisma = new PrismaClient();
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  let token: string;
  let userId: string;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'teste';
    await prisma.user.deleteMany({ where: { email: 'roteiroia@test.com' } });
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Roteiro IA', email: 'roteiroia@test.com', password: 'senha123' });
    token = res.body.token;
    userId = res.body.user.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'roteiroia@test.com' } });
    await prisma.$disconnect();
  });
  beforeEach(() => mockCreate.mockReset());

  const pedir = (body: Record<string, unknown>) =>
    request(app).post('/api/whatsapp/roteiro/sugerir').set('Authorization', `Bearer ${token}`).send(body);

  it('⭐ devolve o rascunho conferido — e não salva nada', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(IMOBILIARIA) }] });
    const r = await pedir({ businessName: 'Imobiliária Rio Negro', product: 'imóveis' });
    expect(r.status).toBe(200);
    expect(r.body.passos).toHaveLength(4);
    expect(r.body.encerramento).toBe(IMOBILIARIA.encerramento);
    expect(await prisma.whatsappConfig.count({ where: { userId } })).toBe(0);
  });

  it('⭐ resposta inaproveitável da IA vira 502 — e o crédito não é cobrado (só 2xx liquida)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Desculpe, não posso ajudar.' }] });
    expect((await pedir({ product: 'imóveis' })).status).toBe(502);
  });

  it('sem produto: 400, sem chamar a IA', async () => {
    expect((await pedir({ businessName: 'X' })).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
