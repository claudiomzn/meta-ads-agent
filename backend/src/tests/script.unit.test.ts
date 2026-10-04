// Modo ROTEIRO FIXO — as partes PURAS.
//
// A regra que todos estes testes defendem: o bot fala o texto do cliente,
// palavra por palavra, e a IA nunca escreve nada. Aqui exercitamos a leitura
// da config, a validação do que a IA devolve (entrada externa) e o resumo que
// chega ao vendedor.
import { describe, it, expect } from 'vitest';
import {
  lerRoteiro,
  roteiroTerminou,
  rotuloDoLead,
  montarResumoDoRoteiro,
  dadosParaCotacao,
  gravarCampo,
  validarValor,
  lerFichaDoSite,
  proximoPassoPendente,
  type PassoDoRoteiro,
} from '../services/whatsapp/script.service.js';

// O roteiro real pedido pelo Luiz em 24/09/2026.
const ROTEIRO_REAL = [
  { pergunta: 'É para você/sua família ou para uma empresa (CNPJ)?', campo: 'tipo' },
  { pergunta: 'Quantas pessoas vão entrar no plano?', campo: 'vidas' },
  { pergunta: 'Qual a idade de cada uma? (se for empresa: quantos funcionários?)', campo: 'idades' },
  { pergunta: 'Já tem plano hoje? Qual?', campo: 'plano_atual' },
  { pergunta: 'Pretende contratar nos próximos dias ou está só pesquisando?', campo: 'urgencia' },
];

describe('lerRoteiro — a config vira passos, sem inventar nada', () => {
  it('lê o roteiro real com os 5 passos e os campos certos', () => {
    const passos = lerRoteiro(ROTEIRO_REAL);
    expect(passos).toHaveLength(5);
    expect(passos[0].pergunta).toBe('É para você/sua família ou para uma empresa (CNPJ)?');
    expect(passos.map((p) => p.campo)).toEqual(['tipo', 'vidas', 'idades', 'plano_atual', 'urgencia']);
  });

  it('⭐ preserva o texto EXATO, sem reescrever, aparar acento ou trocar pontuação', () => {
    // O "Ola" sem acento é DE PROPÓSITO e não deve ser "corrigido" aqui: ele é a
    // prova de que o motor não passa a config por nenhuma reescrita. Um dia esse
    // texto vai ter um erro de digitação de verdade, e o bot tem que mandar o
    // erro — não uma versão melhorada que o cliente nunca aprovou.
    const original = 'Ola, meu nome é Luiz Cláudio Brito, corretor de seguros e planos de saúde.';
    const [passo] = lerRoteiro([{ pergunta: original, campo: null }]);
    expect(passo.pergunta).toBe(original);
  });

  it('descarta passo sem pergunta — mensagem em branco é pior que pergunta a menos', () => {
    const passos = lerRoteiro([
      { pergunta: '', campo: 'tipo' },
      { pergunta: '   ', campo: 'vidas' },
      { campo: 'idades' },
      { pergunta: 'Vale esta?', campo: 'tipo' },
    ]);
    expect(passos).toHaveLength(1);
    expect(passos[0].pergunta).toBe('Vale esta?');
  });

  it('campo desconhecido vira null (pergunta só para o vendedor ler), não quebra', () => {
    const [passo] = lerRoteiro([{ pergunta: 'De onde você é?', campo: 'cidade_favorita' }]);
    expect(passo.campo).toBeNull();
  });

  it('config corrompida ou ausente devolve lista vazia, nunca lança', () => {
    expect(lerRoteiro(null)).toEqual([]);
    expect(lerRoteiro('{}')).toEqual([]);
    expect(lerRoteiro([null, 42, 'oi'])).toEqual([]);
  });
});

describe('roteiroTerminou', () => {
  const passos = lerRoteiro(ROTEIRO_REAL);
  it('só termina quando o índice passa do último passo', () => {
    expect(roteiroTerminou(passos, 0)).toBe(false);
    expect(roteiroTerminou(passos, 4)).toBe(false);
    expect(roteiroTerminou(passos, 5)).toBe(true);
  });
});

describe('validarValor — o que a IA devolve é entrada externa', () => {
  it('tipo aceita só pf/cnpj', () => {
    expect(validarValor('tipo', 'PF')).toBe('pf');
    expect(validarValor('tipo', 'cnpj')).toBe('cnpj');
    expect(validarValor('tipo', 'talvez')).toBeNull();
    expect(validarValor('tipo', null)).toBeNull();
  });

  it('vidas aceita só inteiro positivo plausível', () => {
    expect(validarValor('vidas', 3)).toBe(3);
    expect(validarValor('vidas', '4')).toBe(4);
    expect(validarValor('vidas', 0)).toBeNull();
    expect(validarValor('vidas', 2.5)).toBeNull();
    expect(validarValor('vidas', 1000)).toBeNull();
  });

  it('idades filtra lixo e recusa lista vazia', () => {
    expect(validarValor('idades', [34, 31, 5])).toEqual([34, 31, 5]);
    expect(validarValor('idades', ['34', 'abc', 200])).toEqual([34]);
    expect(validarValor('idades', [])).toBeNull();
    expect(validarValor('idades', 34)).toBeNull();
  });

  it('⭐ "não tenho plano" É uma resposta — vira texto, não vira null', () => {
    expect(validarValor('plano_atual', 'nenhum')).toBe('nenhum');
    expect(validarValor('plano_atual', 'Hapvida')).toBe('Hapvida');
    // null continua significando "não respondeu"
    expect(validarValor('plano_atual', null)).toBeNull();
  });

  it('urgencia aceita só contratar/pesquisando', () => {
    expect(validarValor('urgencia', 'contratar')).toBe('contratar');
    expect(validarValor('urgencia', 'pesquisando')).toBe('pesquisando');
    expect(validarValor('urgencia', 'quem sabe')).toBeNull();
  });
});

describe('rotuloDoLead — o sinal que sobe para Google e Meta', () => {
  it('QUENTE só para quem disse que pretende contratar', () => {
    expect(rotuloDoLead({ urgencia: 'contratar' })).toBe('QUENTE');
  });

  it('⭐ "só pesquisando" é FRIO — afogar o lance inteligente em volume fácil é o erro antigo', () => {
    expect(rotuloDoLead({ urgencia: 'pesquisando' })).toBe('FRIO');
  });

  it('quem NÃO respondeu a pergunta não é QUENTE — ausência de sinal não é sinal', () => {
    expect(rotuloDoLead({ urgencia: null })).toBe('FRIO');
    expect(rotuloDoLead({})).toBe('FRIO');
  });

  it('dado completo de plano não compra o rótulo sozinho', () => {
    expect(rotuloDoLead({ tipo: 'pf', vidas: 2, idades: [30, 28], urgencia: 'pesquisando' })).toBe('FRIO');
  });
});

describe('gravarCampo', () => {
  it('não muta o objeto original', () => {
    const antes = { tipo: 'pf' as const };
    const depois = gravarCampo(antes, 'vidas', 3);
    expect(antes).toEqual({ tipo: 'pf' });
    expect(depois).toEqual({ tipo: 'pf', vidas: 3 });
  });

  it('⭐ grava null quando não veio resposta — diferente de "ainda não perguntamos"', () => {
    const d = gravarCampo({}, 'idades', null);
    expect('idades' in d).toBe(true);
    expect(d.idades).toBeNull();
  });
});

describe('montarResumoDoRoteiro — o que o vendedor lê antes de ligar', () => {
  const passos: PassoDoRoteiro[] = lerRoteiro(ROTEIRO_REAL);

  it('traduz os dados para português de gente', () => {
    const resumo = montarResumoDoRoteiro(passos, {
      tipo: 'pf', vidas: 2, idades: [34, 31], plano_atual: 'nenhum', urgencia: 'contratar',
    });
    expect(resumo).toContain('Tipo: Pessoa física/família');
    expect(resumo).toContain('Pessoas: 2');
    expect(resumo).toContain('Idades: 34, 31');
    expect(resumo).toContain('Plano hoje: nenhum');
    expect(resumo).toContain('Intenção: quer contratar nos próximos dias');
  });

  it('⭐ diz explicitamente o que o lead NÃO respondeu', () => {
    const resumo = montarResumoDoRoteiro(passos, { tipo: 'cnpj', vidas: null });
    expect(resumo).toContain('Tipo: Empresa (CNPJ)');
    expect(resumo).toContain('Pessoas: não respondeu');
    // O que ainda nem foi perguntado não aparece — não é lacuna, é futuro.
    expect(resumo).not.toContain('Idades');
  });

  it('roteiro sem nenhum dado coletado devolve string vazia, não lixo', () => {
    expect(montarResumoDoRoteiro(passos, {})).toBe('');
  });
});

describe('dadosParaCotacao — a ponte para a cotação automática', () => {
  it('entrega o formato que a validação da cotação espera', () => {
    expect(dadosParaCotacao({ tipo: 'pf', vidas: 2, idades: [34, 31] })).toEqual({
      tipo: 'pf', vidas: 2, idades: [34, 31], operadora: null,
    });
  });

  it('ausência vira null/[] — nunca um valor inventado', () => {
    expect(dadosParaCotacao({})).toEqual({ tipo: null, vidas: null, idades: [], operadora: null });
  });
});

// Ficha que chega pronta do segurosamazon.com (04/10/2026). As mensagens abaixo
// são as que o site.js monta HOJE — se o formato mudar lá, estes testes são o
// aviso de que o bot voltou a perguntar tudo de novo.
describe('lerFichaDoSite — o bot não pergunta o que o site já perguntou', () => {
  const CHAT = 'Olá! Quero uma cotação de plano de saúde.\n• Nome: Maria Souza\n• Para: Eu e minha família\n• Operadora: Hapvida\n• Pessoas: 1 pessoa\n• Quando: o quanto antes\n\n(ref. HAP-G-21345678901)';
  const SIMULADOR = 'Olá! Quero uma cotação de plano de saúde.\n• Para: Só para mim\n• Pessoas: 3 (idades: 34, 31, 5)\n• Operadora: Samel\n• Plano atual: Não tenho\n• Nome: João\n\n(ref. SAM-D)';

  it('⭐ balão de chat: tipo, pessoas, operadora e urgência', () => {
    expect(lerFichaDoSite(CHAT)).toEqual({ tipo: 'pf', vidas: 1, operadora: 'Hapvida', urgencia: 'contratar' });
  });

  it('⭐ simulador: idades viram lista, pessoas vem da contagem, "Não tenho" vira nenhum', () => {
    expect(lerFichaDoSite(SIMULADOR)).toEqual({ tipo: 'pf', vidas: 3, idades: [34, 31, 5], operadora: 'Samel', plano_atual: 'nenhum' });
  });

  it('⭐ só "o quanto antes" é QUENTE — "próximos meses" e "avaliando" não', () => {
    const q = (quando: string) => lerFichaDoSite(`Quero uma cotação\n• Quando: ${quando}`).urgencia;
    expect(q('o quanto antes')).toBe('contratar');
    expect(q('nos próximos meses')).toBe('pesquisando');
    expect(q('ainda avaliando')).toBe('pesquisando');
  });

  it('MEI e empresa vão como CNPJ (empresarial, cotação com o corretor)', () => {
    expect(lerFichaDoSite('Quero uma cotação\n• Para: Sou MEI').tipo).toBe('cnpj');
    expect(lerFichaDoSite('Quero uma cotação\n• Para: Minha empresa (CNPJ)').tipo).toBe('cnpj');
  });

  it('o que é ambíguo NÃO é preenchido — o roteiro pergunta', () => {
    const f = lerFichaDoSite('Quero uma cotação\n• Pessoas: 2 a 4 pessoas\n• Operadora: Quero comparar\n• Plano atual: Sim: não informou\n• Quando: semana que vem');
    expect(f).toEqual({});
  });

  it('plano atual informado entra como texto', () => {
    expect(lerFichaDoSite('Quero uma cotação\n• Plano atual: Sim: Unimed').plano_atual).toBe('Unimed');
  });

  it('mensagem comum não é ficha', () => {
    expect(lerFichaDoSite('oi, quanto custa?')).toEqual({});
    expect(lerFichaDoSite('Olá! Quero uma cotação do plano Hapvida.\n\n(ref. HAP-G)')).toEqual({});
  });
});

describe('proximoPassoPendente — pula o que já foi respondido', () => {
  const passos: PassoDoRoteiro[] = [
    { pergunta: 'P1', campo: 'tipo' },
    { pergunta: 'P2', campo: 'vidas' },
    { pergunta: 'Recado', campo: null },
    { pergunta: 'P3', campo: 'idades' },
  ];

  it('pula os campos preenchidos e para no primeiro que falta', () => {
    expect(proximoPassoPendente(passos, 0, { tipo: 'pf' })).toBe(1);
    expect(proximoPassoPendente(passos, 0, {})).toBe(0);
  });

  it('passo sem campo nunca é pulado', () => {
    expect(proximoPassoPendente(passos, 0, { tipo: 'pf', vidas: 2 })).toBe(2);
  });

  it('tudo respondido = fim do roteiro', () => {
    expect(proximoPassoPendente(passos, 3, { idades: [30] })).toBe(4);
  });
});

