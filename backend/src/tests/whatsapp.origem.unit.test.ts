import { describe, expect, it } from 'vitest';
import {
  extrairDadosDoAnuncio, lerRefDoSite, linhaDeOrigem, pareceAnuncio, resolverOrigem,
} from '../services/whatsapp/origem.js';

const msgSite = 'Olá! Quero uma cotação do plano Hapvida.\n\n(ref. HAP-G)';

describe('lerRefDoSite — o código que o segurosamazon.com põe na 1ª mensagem', () => {
  it.each([
    ['(ref. HAP-G)', 'HAP-G', 'google'],
    ['(ref. SAM-M)', 'SAM-M', 'meta'],
    ['(ref. HOM-O)', 'HOM-O', 'organico'],
    ['(ref. BLG-R)', 'BLG-R', 'outro_site'],
    ['(ref. SIT-D)', 'SIT-D', 'direto'],
  ])('%s → %s / %s', (txt, ref, canal) => {
    expect(lerRefDoSite(`Olá\n\n${txt}`)).toMatchObject({ ref, canal });
  });

  it('mensagem sem código (ou código malformado) → null, nunca canal inventado', () => {
    expect(lerRefDoSite('oi, quero plano')).toBeNull();
    expect(lerRefDoSite('(ref. hap-g)')).toBeNull();
    expect(lerRefDoSite('(ref. HAP-X)')).toBeNull();
  });
});

describe('extrairDadosDoAnuncio — referral do anúncio CTWA, onde quer que a Evolution ponha', () => {
  const externalAdReply = { ctwaClid: 'ARAkLkA8rmlFeiCktEJQ', sourceId: '120210000000000', sourceType: 'ad' };

  it('⭐ dentro da mensagem (message.extendedTextMessage.contextInfo)', () => {
    const data = { key: {}, message: { extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply } } } };
    expect(extrairDadosDoAnuncio({ event: 'messages.upsert', data })).toEqual({
      ctwaClid: 'ARAkLkA8rmlFeiCktEJQ', anuncioId: '120210000000000',
    });
  });

  it('⭐ no topo de data.contextInfo (outra versão da Evolution)', () => {
    const data = { key: {}, message: { conversation: 'oi' }, contextInfo: { externalAdReply } };
    expect(extrairDadosDoAnuncio({ data: [data] })?.ctwaClid).toBe('ARAkLkA8rmlFeiCktEJQ');
  });

  it('mensagem comum (sem anúncio) → null', () => {
    expect(extrairDadosDoAnuncio({ data: { key: {}, message: { conversation: 'oi' } } })).toBeNull();
    expect(pareceAnuncio({ data: { key: {}, message: { conversation: 'oi' } } })).toBe(false);
  });

  it('externalAdReply sem click id nem anúncio → null (mas pareceAnuncio avisa, para o log)', () => {
    const raw = { data: { contextInfo: { externalAdReply: { title: 'Plano' } } } };
    expect(extrairDadosDoAnuncio(raw)).toBeNull();
    expect(pareceAnuncio(raw)).toBe(true);
  });

  it('payload torto (string, null, ciclo de arrays fundo) não quebra', () => {
    expect(extrairDadosDoAnuncio('texto')).toBeNull();
    expect(extrairDadosDoAnuncio(null)).toBeNull();
    let fundo: unknown = { externalAdReply: { ctwaClid: 'x' } };
    for (let i = 0; i < 20; i++) fundo = [fundo];
    expect(extrairDadosDoAnuncio(fundo)).toBeNull(); // além da profundidade: ignora
  });
});

describe('resolverOrigem', () => {
  it('⭐ anúncio CTWA vence o código do site (é prova direta)', () => {
    const o = resolverOrigem(msgSite, { ctwaClid: 'C1', anuncioId: 'A1' });
    expect(o).toEqual({ origemCanal: 'meta_whatsapp', origemRef: 'HAP-G', ctwaClid: 'C1', origemAnuncioId: 'A1', origemCampanhaId: null });
  });

  it('só o código do site', () => {
    expect(resolverOrigem(msgSite, null)).toEqual({
      origemCanal: 'google', origemRef: 'HAP-G', ctwaClid: null, origemAnuncioId: null, origemCampanhaId: null,
    });
  });

  it('nada → tudo null (desconhecida, não "direto")', () => {
    expect(resolverOrigem('oi', null).origemCanal).toBeNull();
  });
});

describe('linhaDeOrigem — o vendedor sabe de onde veio o lead', () => {
  it('com ref', () => {
    expect(linhaDeOrigem({ origemCanal: 'google', origemRef: 'HAP-G' })).toBe('Origem: anúncio do Google, pelo site (ref. HAP-G)');
  });
  it('desconhecida → null (não escreve "Origem: ?")', () => {
    expect(linhaDeOrigem({ origemCanal: null, origemRef: null })).toBeNull();
    expect(linhaDeOrigem({ origemCanal: 'lixo', origemRef: null })).toBeNull();
  });
});

describe('campanha no código do site (01/10/2026)', () => {
  it('⭐ "(ref. HAP-G-21345678901)" → canal google + campanha', () => {
    expect(lerRefDoSite('Olá\n\n(ref. HAP-G-21345678901)')).toEqual({
      ref: 'HAP-G', pagina: 'HAP', canal: 'google', campanhaId: '21345678901',
    });
  });

  it('formato antigo segue valendo, sem campanha', () => {
    expect(lerRefDoSite('(ref. HAP-G)')?.campanhaId).toBeNull();
  });

  it('número curto demais não é ID de campanha → o código inteiro não casa', () => {
    expect(lerRefDoSite('(ref. HAP-G-123)')).toBeNull();
  });

  it('⭐ veio do anúncio CTWA: a campanha do site NÃO vale (é a do anúncio, resolvida na Meta)', () => {
    const o = resolverOrigem('(ref. HAP-G-21345678901)', { ctwaClid: 'C', anuncioId: '1' });
    expect(o.origemCampanhaId).toBeNull();
    expect(resolverOrigem('(ref. HAP-G-21345678901)', null).origemCampanhaId).toBe('21345678901');
  });
});
