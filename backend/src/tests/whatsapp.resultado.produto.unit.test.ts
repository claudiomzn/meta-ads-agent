// O que foi vendido, na resposta do vendedor (23/10/2026).
//
// Caso real: a campanha "[Site novo] Planos de Saúde Manaus" fechou 2 vendas
// com leads do grupo Adventista (Proasa) — e as duas foram Hapvida individual.
// "fechou 958,80 hapvida individual" passa a gravar o valor E o produto. Cada
// teste com ⭐ reprova o parser anterior: ele não lia produto nenhum, lia
// "amil 400 por 958,80" como R$ 400 e tomava "hapvida individual" por nome
// de lead (perguntando "qual deles?" com um lead aberto só).
import { describe, it, expect } from 'vitest';
import {
  escolherLead,
  interpretarRespostaDoVendedor,
  lerProduto,
  lerValorEmCentavos,
  type LeadAberto,
} from '../services/whatsapp/resultado.js';
import { textoDaVendaRegistrada } from '../services/whatsapp/resultado.service.js';

describe('interpretarRespostaDoVendedor — produto', () => {
  it('⭐ "fechou 958,80 hapvida individual" grava valor e produto', () => {
    expect(interpretarRespostaDoVendedor('fechou 958,80 hapvida individual')).toMatchObject({
      resultado: 'venda', valorCents: 95880, produto: 'Hapvida individual',
    });
  });

  it('"fechou 958,80" sem texto continua funcionando, sem produto', () => {
    const r = interpretarRespostaDoVendedor('fechou 958,80');
    expect(r).toMatchObject({ resultado: 'venda', valorCents: 95880 });
    expect(r).not.toHaveProperty('produto');
  });

  it('⭐ número do plano não vira valor: "fechou amil 400 por 958,80"', () => {
    expect(interpretarRespostaDoVendedor('fechou amil 400 por 958,80')).toMatchObject({
      valorCents: 95880, produto: 'Amil 400',
    });
  });

  it('⭐ "fechou amil 400" sozinho é ambíguo: sem valor (o bot pergunta), produto "Amil"', () => {
    const r = interpretarRespostaDoVendedor('fechou amil 400');
    expect(r).toMatchObject({ resultado: 'venda', produto: 'Amil' });
    expect(r).not.toHaveProperty('valorCents');
    expect(lerValorEmCentavos('fechou amil 400')).toBeNull();
  });

  it('valor depois da modalidade continua sendo valor', () => {
    expect(interpretarRespostaDoVendedor('fechou hapvida individual 578')).toMatchObject({
      valorCents: 57800, produto: 'Hapvida individual',
    });
  });

  it('valor no meio do produto não corta o produto', () => {
    expect(interpretarRespostaDoVendedor('fechou hapvida 958,80 individual')).toMatchObject({
      valorCents: 95880, produto: 'Hapvida individual',
    });
  });

  it('nomes compostos e acento: SulAmérica, Bradesco Saúde, adesão, coparticipação', () => {
    expect(lerProduto('fechou 578 proasa por adesão')).toBe('Proasa por adesão');
    expect(lerProduto('fechou R$ 1.200 bradesco saude pme')).toBe('Bradesco Saúde PME');
    expect(lerProduto('fechei unimed plus 2 por 900 com coparticipação')).toBe('Unimed Plus 2 com coparticipação');
    expect(lerProduto('fechou 700 sulamerica individual')).toBe('SulAmérica individual');
  });

  it('"2 vidas" continua fora do valor, e o produto sai depois', () => {
    expect(interpretarRespostaDoVendedor('fechou 2 vidas por 1200 samel familiar')).toMatchObject({
      valorCents: 120000, produto: 'Samel familiar',
    });
  });

  it('palavra comum não vira produto ("zona sul", "hoje", nome de lead)', () => {
    expect(lerProduto('fechou 1200 zona sul')).toBeNull();
    expect(lerProduto('fechou 1200 hoje')).toBeNull();
    expect(lerProduto('fechou 1200 João')).toBeNull();
  });

  it('o produto não aparece em perda nem negociação', () => {
    expect(interpretarRespostaDoVendedor('perdeu preço hapvida individual')).not.toHaveProperty('produto');
    expect(interpretarRespostaDoVendedor('em negociação hapvida')).not.toHaveProperty('produto');
  });
});

describe('o produto não atrapalha achar o lead', () => {
  const joao: LeadAberto = { id: 'j', leadPhone: '559291111001', nome: 'João Silva', handoffEm: new Date() };
  const maria: LeadAberto = { id: 'm', leadPhone: '559291111002', nome: 'Maria Souza', handoffEm: new Date() };

  it('⭐ com um lead aberto só, "hapvida individual" não vira pergunta "qual deles?"', () => {
    const r = interpretarRespostaDoVendedor('fechou 958,80 hapvida individual')!;
    expect(escolherLead({ pista: r.pista, abertos: [joao] })).toEqual({ lead: joao });
  });

  it('nome junto do produto ainda escolhe o lead certo', () => {
    const r = interpretarRespostaDoVendedor('fechou 958,80 hapvida individual maria')!;
    expect(r.produto).toBe('Hapvida individual');
    expect(escolherLead({ pista: r.pista, abertos: [joao, maria] })).toEqual({ lead: maria });
  });
});

describe('textoDaVendaRegistrada — produto na confirmação', () => {
  it('mostra o produto quando há', () => {
    expect(textoDaVendaRegistrada('João', 95880, { tela: 'gravada', google: 'enviada', meta: 'enviada' }, 'Hapvida individual'))
      .toBe('✅ Venda de R$ 958,80 (Hapvida individual) registrada para João');
  });

  it('sem produto, a frase de sempre', () => {
    expect(textoDaVendaRegistrada('João', 95880, { tela: 'gravada', google: 'enviada', meta: 'enviada' }))
      .toBe('✅ Venda de R$ 958,80 registrada para João');
  });
});
