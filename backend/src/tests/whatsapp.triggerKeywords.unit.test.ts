// Testes unitários das funções puras de palavra-gatilho (15/09/2026): o
// campo passou a aceitar UMA frase ou VÁRIAS separadas por vírgula — a
// integração completa (via /simulate) está em whatsapp.test.ts; aqui só a
// lógica pura de parse/match, isolada e rápida.
import { describe, expect, it } from 'vitest';
import { matchesAnyTrigger, parseTriggerKeywords } from '../services/whatsapp/whatsapp.service.js';

describe('parseTriggerKeywords', () => {
  it('uma frase só: lista de 1', () => {
    expect(parseTriggerKeywords('Vi seu anúncio e quero uma cotação')).toEqual(['Vi seu anúncio e quero uma cotação']);
  });

  it('várias separadas por vírgula, com espaço nas pontas removido', () => {
    expect(parseTriggerKeywords('vi o anúncio, quero cotação , promoção samel'))
      .toEqual(['vi o anúncio', 'quero cotação', 'promoção samel']);
  });

  it('vírgulas seguidas ou nas pontas não geram gatilho vazio', () => {
    expect(parseTriggerKeywords(',vi o anúncio,, quero cotação,')).toEqual(['vi o anúncio', 'quero cotação']);
  });

  it('campo vazio ou só espaço: lista vazia', () => {
    expect(parseTriggerKeywords('')).toEqual([]);
    expect(parseTriggerKeywords('   ')).toEqual([]);
  });
});

describe('matchesAnyTrigger', () => {
  it('campo vazio (null/undefined/"") = sem restrição, atende qualquer mensagem', () => {
    expect(matchesAnyTrigger(null, 'oi, tudo bem?')).toBe(true);
    expect(matchesAnyTrigger(undefined, 'oi, tudo bem?')).toBe(true);
    expect(matchesAnyTrigger('', 'oi, tudo bem?')).toBe(true);
  });

  it('um gatilho só: precisa estar contido na mensagem (sem caixa/acento)', () => {
    expect(matchesAnyTrigger('Cotação', 'quero uma cotacao agora')).toBe(true);
    expect(matchesAnyTrigger('Cotação', 'oi, tudo bem?')).toBe(false);
  });

  it('vários gatilhos: basta UM casar', () => {
    const gatilhos = 'vi o anúncio, quero cotação, promoção samel';
    expect(matchesAnyTrigger(gatilhos, 'vi o anuncio no facebook')).toBe(true);
    expect(matchesAnyTrigger(gatilhos, 'ola, quero cotacao pra minha familia')).toBe(true);
    expect(matchesAnyTrigger(gatilhos, 'vi a PROMOÇÃO SAMEL')).toBe(true);
    expect(matchesAnyTrigger(gatilhos, 'oi, tudo bem?')).toBe(false);
  });

  it('gatilho de uma só letra/vazio no meio da lista não vira coringa que casa tudo', () => {
    // "vi o anúncio, , quero cotação" -> parse já descarta o item vazio;
    // aqui confirmamos que a lista final não contém string vazia disfarçada.
    expect(matchesAnyTrigger('vi o anúncio, , quero cotação', 'mensagem qualquer sem nada em comum')).toBe(false);
  });
});
