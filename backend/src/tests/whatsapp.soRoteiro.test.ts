// O robô SÓ fala por roteiro (Luiz, 15/10/2026: "acho bom não ter essa opção de
// IA, pois pode dar problemas"). O antigo modo IA escrevia cada mensagem e
// mandou conversa fora de contexto a leads de verdade.
//
// Caso real que estes testes reproduzem: o robô da Daniele estava no modo IA,
// com as perguntas dela no campo "Perguntas de qualificação" — a primeira
// linha é a apresentação, sem "?".
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WhatsappService } from '../services/whatsapp/whatsapp.service.js';
import { LogTransport } from '../services/whatsapp/transport.js';
import {
  ENCERRAMENTO_PADRAO, PERGUNTA_DE_URGENCIA, campoDaPergunta, roteiroDasPerguntas, roteiroEfetivo,
} from '../services/whatsapp/roteiro.efetivo.js';

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  resetPasswordEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
  welcomeEmail: vi.fn().mockReturnValue({ html: '', text: '' }),
}));
vi.mock('../services/whatsapp/origem.meta.js', () => ({ resolverCampanhaDoAnuncio: vi.fn(async () => null) }));

const PERGUNTAS_DA_DANIELE = [
  'Ola, meu nome é Daniele Brito, corretora de seguros e planos de saúde.',
  'É para você/sua família ou para uma empresa (CNPJ)?',
  'Quantas pessoas vão entrar no plano?',
  'Qual a idade de cada uma? (se for empresa: quantos funcionários?)',
  'Já tem plano hoje? Qual?',
  'Pretende contratar nos próximos dias ou está só pesquisando?',
];

describe('as perguntas do antigo modo IA viram roteiro', () => {
  it('⭐ o caso da Daniele: apresentação separada, cada pergunta literal com o campo certo', () => {
    const r = roteiroDasPerguntas(PERGUNTAS_DA_DANIELE);
    expect(r.intro).toBe('Ola, meu nome é Daniele Brito, corretora de seguros e planos de saúde.');
    expect(r.passos).toEqual([
      { pergunta: 'É para você/sua família ou para uma empresa (CNPJ)?', campo: 'tipo' },
      { pergunta: 'Quantas pessoas vão entrar no plano?', campo: 'vidas' },
      { pergunta: 'Qual a idade de cada uma? (se for empresa: quantos funcionários?)', campo: 'idades' },
      { pergunta: 'Já tem plano hoje? Qual?', campo: 'plano_atual' },
      { pergunta: 'Pretende contratar nos próximos dias ou está só pesquisando?', campo: 'urgencia' },
    ]);
  });

  it('⭐ sem pergunta de urgência, ela é acrescentada — senão todo lead sai FRIO e a conversão para', () => {
    const r = roteiroDasPerguntas(['Quantas pessoas?']);
    expect(r.passos.at(-1)).toEqual({ pergunta: PERGUNTA_DE_URGENCIA, campo: 'urgencia' });
  });

  it('o mesmo campo não é coletado duas vezes; texto sem pista vai sem campo', () => {
    expect(roteiroDasPerguntas(['Qual a idade?', 'E a idade do cônjuge?', 'Qual o seu nome?']).passos.slice(0, 3))
      .toEqual([
        { pergunta: 'Qual a idade?', campo: 'idades' },
        { pergunta: 'E a idade do cônjuge?', campo: null },
        { pergunta: 'Qual o seu nome?', campo: null },
      ]);
    expect(campoDaPergunta('Qual o seu nome?')).toBeNull();
  });

  it('só apresentação, sem pergunta nenhuma: não há roteiro', () => {
    expect(roteiroDasPerguntas(['Olá, tudo bem.']).passos).toEqual([]);
    expect(roteiroDasPerguntas([]).passos).toEqual([]);
  });

  it('roteiro salvo vale sempre — scriptEnabled não importa mais', () => {
    const salvo = [{ pergunta: 'Qual a idade?', campo: 'idades' }];
    const r = roteiroEfetivo({ scriptSteps: salvo, scriptIntro: 'Oi', scriptClosing: null, questions: PERGUNTAS_DA_DANIELE });
    expect(r).toEqual({ intro: 'Oi', passos: salvo, encerramento: null, convertido: false });
  });

  it('convertido ganha encerramento: sem ele o lead responderia a última pergunta e ficaria sem retorno', () => {
    expect(roteiroEfetivo({ scriptSteps: [], scriptIntro: null, scriptClosing: null, questions: ['Quantas pessoas?'] }).encerramento)
      .toBe(ENCERRAMENTO_PADRAO);
  });
});

describe('a IA não escreve mais nada para o lead', () => {
  it('⭐ o motor que escrevia as mensagens foi apagado', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    expect(existsSync(join(dir, '../services/whatsapp/qualification.service.ts'))).toBe(false);
    const svc = readFileSync(join(dir, '../services/whatsapp/whatsapp.service.ts'), 'utf-8');
    expect(svc).not.toContain('nextReply');
    expect(svc).not.toContain('if (config.scriptEnabled)');
  });
});

describe('⭐ robô no antigo modo IA, de ponta a ponta', () => {
  const prisma = new PrismaClient();
  const enviadas: { to: string; text: string }[] = [];
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'soroteiro@test.com' } });
    const u = await prisma.user.create({ data: { email: 'soroteiro@test.com', password: 'x', name: 'Só Roteiro' } });
    userId = u.id;
    // Exatamente como estava o robô da Daniele: modo IA, perguntas no campo antigo.
    await prisma.whatsappConfig.create({
      data: {
        userId, businessId: 'default', businessName: 'Samel sáude', product: 'Plano de saúde', enabled: true,
        transport: 'none', scriptEnabled: false, questions: PERGUNTAS_DA_DANIELE,
      },
    });
    vi.spyOn(LogTransport.prototype, 'sendText').mockImplementation(async (to: string, text: string) => {
      enviadas.push({ to, text });
    });
  });

  afterAll(async () => {
    await prisma.whatsappConversation.deleteMany({ where: { userId } });
    await prisma.whatsappConfig.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('o lead recebe EXATAMENTE a apresentação e a 1ª pergunta que ela escreveu — nada mais', async () => {
    const r = await new WhatsappService(userId).handleInbound({
      from: '5592900000901', text: 'Olá! Quero mais informações.', transport: 'log',
      anuncio: { ctwaClid: 'CLID', anuncioId: 'AD-1' },
    });
    expect(r).not.toBeNull();
    expect(enviadas.map((e) => e.text)).toEqual([
      'Ola, meu nome é Daniele Brito, corretora de seguros e planos de saúde.',
      'É para você/sua família ou para uma empresa (CNPJ)?',
    ]);
  });
});
