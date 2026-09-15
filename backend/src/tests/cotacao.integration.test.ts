import { describe, it, expect, vi } from 'vitest';
import {
  cotarRespeitandoPreferencia,
  extrairDadosParaCotacao,
  montarNotaParaVendedor,
  pedirCotacao,
  podeCotarAutomaticamente,
  REPLY_COTACAO_AGORA,
  resolverIntegracao,
} from '../services/whatsapp/cotacao.integration.js';

const ENV_OK = {
  COTE_QUOTE_USER: 'claudio@exemplo.com',
  COTE_QUOTE_URL: 'https://x.supabase.co/functions/v1/cotacao-externa',
  COTE_QUOTE_KEY: 'chave',
};

describe('resolverIntegracao — só a conta configurada', () => {
  const luiz = { userId: 'user-luiz', email: 'Claudio@Exemplo.com' };

  it('liga pelo e-mail (sem caixa) e traz a operadora padrão', () => {
    const i = resolverIntegracao(luiz, ENV_OK);
    expect(i).toEqual({ url: ENV_OK.COTE_QUOTE_URL, key: 'chave', operadoras: ['samel'] });
  });

  it('liga também pelo id interno', () => {
    expect(resolverIntegracao(luiz, { ...ENV_OK, COTE_QUOTE_USER: 'user-luiz' })).not.toBeNull();
  });

  it('qualquer outro cliente do AdsGenius: null — o bot segue como sempre', () => {
    expect(resolverIntegracao({ userId: 'outro', email: 'outro@x.com' }, ENV_OK)).toBeNull();
  });

  it('sem alguma variável, ninguém tem integração (nem o configurado)', () => {
    expect(resolverIntegracao(luiz, { ...ENV_OK, COTE_QUOTE_KEY: '' })).toBeNull();
    expect(resolverIntegracao(luiz, {})).toBeNull();
  });

  it('leque padrão configurável: lista separada por vírgula, sem caixa', () => {
    expect(resolverIntegracao(luiz, { ...ENV_OK, COTE_QUOTE_OPERATOR: 'Samel, Hapvida ,' })?.operadoras)
      .toEqual(['samel', 'hapvida']);
  });
});

describe('extrairDadosParaCotacao — o que a IA estruturou é entrada externa', () => {
  it('o caso da simulação: família, 3 vidas, 5/10/35', () => {
    expect(extrairDadosParaCotacao({ tipo: 'pf', vidas: 3, idades: [5, 10, 35] }))
      .toEqual({ tipo: 'pf', idades: [5, 10, 35] });
  });

  it('idades como string ("35") entram; lixo e fora de faixa caem', () => {
    expect(extrairDadosParaCotacao({ tipo: 'pf', idades: ['35', 'abc', 0, 130, 42.5] }))
      .toEqual({ tipo: 'pf', idades: [35] });
  });

  it('sem idades não há cotação — a IA foi instruída a não estimar', () => {
    expect(extrairDadosParaCotacao({ tipo: 'pf', idades: [] })).toBeNull();
    expect(extrairDadosParaCotacao({ tipo: 'pf' })).toBeNull();
  });

  it('vidas ≠ quantidade de idades é dado incoerente: não cota', () => {
    expect(extrairDadosParaCotacao({ tipo: 'pf', vidas: 3, idades: [35] })).toBeNull();
  });

  it('operadora que o lead pediu vem junto; vazia não vem', () => {
    expect(extrairDadosParaCotacao({ tipo: 'pf', idades: [35], operadora: ' Hapvida ' }))
      .toEqual({ tipo: 'pf', idades: [35], operadora: 'Hapvida' });
    expect(extrairDadosParaCotacao({ tipo: 'pf', idades: [35], operadora: null })).toEqual({ tipo: 'pf', idades: [35] });
  });

  it('tipo desconhecido, null ou não-objeto: null', () => {
    expect(extrairDadosParaCotacao({ tipo: 'empresa', idades: [35] })).toBeNull();
    expect(extrairDadosParaCotacao(null)).toBeNull();
    expect(extrairDadosParaCotacao('pf')).toBeNull();
  });
});

describe('podeCotarAutomaticamente — só pessoa física', () => {
  it('PF sim, CNPJ não (vai ao corretor), null não', () => {
    expect(podeCotarAutomaticamente({ tipo: 'pf', idades: [35] })).toBe(true);
    expect(podeCotarAutomaticamente({ tipo: 'cnpj', idades: [35, 40] })).toBe(false);
    expect(podeCotarAutomaticamente(null)).toBe(false);
  });
});

describe('pedirCotacao — a chamada ao Cote+', () => {
  const integracao = { url: ENV_OK.COTE_QUOTE_URL, key: 'chave', operadoras: ['samel'] };

  it('sem preferência: manda o leque padrão', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, texto: 'x', planos: [{}] }) });
    await pedirCotacao({ ...integracao, operadoras: ['samel', 'hapvida'] }, { tipo: 'pf', idades: [35] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).operadoras).toEqual(['samel', 'hapvida']);
  });

  it('com preferência: manda só a operadora que o lead pediu', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, texto: 'x', planos: [{}] }) });
    await pedirCotacao(integracao, { tipo: 'pf', idades: [35], operadora: 'Hapvida' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).operadoras).toEqual(['Hapvida']);
  });

  it('manda idades, operadora e a chave no header; devolve o corpo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, texto: 'Cotação…', avisos: [] }),
    });
    const r = await pedirCotacao(integracao, { tipo: 'pf', idades: [5, 10, 35] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.texto).toBe('Cotação…');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(integracao.url);
    expect(init.headers['x-integration-key']).toBe('chave');
    expect(JSON.parse(init.body)).toMatchObject({ idades: [5, 10, 35], operadoras: ['samel'], modalidade: 'individual' });
  });

  it('HTTP não-ok lança com o status — quem chama faz o fallback honesto', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Não autorizado' }) });
    await expect(pedirCotacao(integracao, { tipo: 'pf', idades: [35] }, { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/401.*Não autorizado/);
  });
});

describe('cotarRespeitandoPreferencia — pediu operadora que não existe', () => {
  const integracao = { url: ENV_OK.COTE_QUOTE_URL, key: 'chave', operadoras: ['samel'] };
  const dados = { tipo: 'pf' as const, idades: [35], operadora: 'Unimed' };

  it('operadora pedida sem plano: cota o leque padrão e avisa o lead', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, texto: '', planos: [], operadoras_nao_encontradas: ['unimed'] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, texto: 'Samel: R$ 300', planos: [{}], avisos: [] }) });
    const r = await cotarRespeitandoPreferencia(integracao, dados, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).operadoras).toEqual(['samel']);
    expect(r.texto).toMatch(/^Não trabalho com Unimed por aqui, mas estas são as opções que tenho:/);
    expect(r.texto).toContain('Samel: R$ 300');
    expect(r.avisos?.[0]).toContain('Lead pediu "Unimed"');
  });

  it('operadora pedida com plano: uma chamada só, texto intacto', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, texto: 'Hapvida: R$ 200', planos: [{}] }) });
    const r = await cotarRespeitandoPreferencia(integracao, { ...dados, operadora: 'Hapvida' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.texto).toBe('Hapvida: R$ 200');
  });

  it('sem preferência e sem plano: não tenta de novo (nada a substituir)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, texto: '', planos: [] }) });
    await cotarRespeitandoPreferencia(integracao, { tipo: 'pf', idades: [35] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('montarNotaParaVendedor — o vendedor nunca repete as perguntas', () => {
  const dados = { tipo: 'pf' as const, idades: [5, 10, 35] };

  it('cotação enviada: idades + operadora pedida + o texto que o lead viu + avisos', () => {
    const nota = montarNotaParaVendedor({ ...dados, operadora: 'Samel' }, { ok: true, texto: 'Samel: R$ 900', avisos: ['tabela vence em 20 dias'] });
    expect(nota).toContain('Idades: 5, 10, 35 (PF) · pediu Samel');
    expect(nota).toContain('✅ Cotação enviada ao lead');
    expect(nota).toContain('R$ 900');
    expect(nota).toContain('⚠️ tabela vence em 20 dias');
  });

  it('Cote+ falhou: diz que o lead está esperando a cotação do vendedor', () => {
    const nota = montarNotaParaVendedor(dados, null, 'cotacao-externa 503');
    expect(nota).toContain('falhou (cotacao-externa 503)');
    expect(nota).toContain('o lead ficou esperando');
  });

  it('Cote+ respondeu sem plano vigente: também é "o lead ficou esperando"', () => {
    const nota = montarNotaParaVendedor(dados, { ok: true, texto: '', avisos: ['Nenhum plano de "samel"'] });
    expect(nota).toContain('Sem plano com tabela vigente');
    expect(nota).toContain('o lead ficou esperando');
  });

  it('CNPJ: avisa que a cotação fica com o corretor', () => {
    expect(montarNotaParaVendedor({ tipo: 'cnpj', idades: [40, 42] }, null)).toContain('Empresarial: cotação fica com você');
  });

  it('sem dados: diz que as idades não foram identificadas', () => {
    expect(montarNotaParaVendedor(null, null)).toContain('não identificadas');
  });
});

describe('a frase fixa', () => {
  it('é a que o Luiz pediu, e promete só o que o código cumpre em seguida', () => {
    expect(REPLY_COTACAO_AGORA).toBe('Ótimo! Vou te passar uma cotação agora 😊');
  });
});
