// Regras PURAS do desfecho do lead: o que o vendedor respondeu, a qual lead a
// resposta se refere e quando cobrar retorno dele.
//
// Tudo aqui é função pura (sem prisma, sem rede) — é o que permite testar a
// interpretação de "fechou 1.200,00" sem subir banco. O orquestrador com
// efeito colateral é o resultado.service.ts.
//
// ⭐ Por que NÃO tem IA nenhuma neste arquivo: a resposta do vendedor registra
// VENDA com valor e sobe conversão para o Google e para a Meta. Errar o valor
// por interpretação criativa de um modelo contamina a medição de lucro do
// cliente — o oposto do princípio do produto. Palavra-gatilho explícita e
// número lido por regex falham de forma previsível: quando não dá para
// entender, o bot PERGUNTA em vez de chutar.

import { chaveDoTelefone } from './funil.js';

/** Desfecho de um lead que já foi para o vendedor. */
export type Resultado = 'venda' | 'perdido' | 'negociando';

/** Categorias simples de perda — o que cabe numa resposta de WhatsApp. */
export type MotivoPerda = 'preco' | 'carencia' | 'ja_tem_plano' | 'nao_respondeu' | 'outro';

export interface RespostaDoVendedor {
  resultado: Resultado;
  /** Valor da venda em centavos. Ausente = o vendedor disse "fechou" sem valor. */
  valorCents?: number;
  /** O que foi vendido ("Hapvida individual"), quando o vendedor escreveu.
   *  Ausente = não disse; a venda vale igual (ver lerProduto). */
  produto?: string;
  motivo?: MotivoPerda;
  /** O texto cru do motivo, como o vendedor escreveu (vai para o relatório). */
  motivoTexto?: string;
  /** O que sobrou da mensagem: serve de pista de QUAL lead (nome ou número). */
  pista: string;
}

// Sem diacríticos, minúsculas — "Negociação" casa com "negociacao".
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// As três portas. Ordem de leitura (achada em revisão, 12/10/2026):
//   1. negociação EXPLÍCITA ("ainda não fechou", "vai pensar") — senão o
//      "nao fechou" de dentro dela marcava como perdido e calava o lembrete;
//   2. perda — antes de venda, porque "não fechou" e "fechou com outro"
//      contêm "fechou" e virariam VENDA, com valor e conversão subindo;
//   3. negociação genérica;
//   4. venda.
const GATILHOS_NEGOCIACAO_PRIORITARIA = [
  'ainda nao fechou', 'nao fechou ainda', 'ainda nao decidiu', 'ainda pensando',
  'vai pensar', 'ta pensando', 'esta pensando',
];
const GATILHOS_PERDA = [
  'perdeu', 'perdi', 'perdido', 'perdemos',
  'nao fechou', 'nao fechei', 'nao vai fechar', 'nao quis', 'desistiu', 'recusou',
  // "fechou com outro, 300 mais barato" era lido como VENDA de R$ 300.
  'fechou com outr', 'fechou com a concorr', 'foi para outr', 'foi pra outr',
  // "sem venda" casava com o gatilho "venda" e o bot perguntava o valor.
  'sem venda', 'nao teve venda', 'nao vendeu', 'nao vendi',
];
const GATILHOS_NEGOCIACAO = [
  'em negociacao', 'negociacao', 'negociando', 'negocia',
  'em andamento', 'analisando', 'pensando', 'vai pensar', 'aguardando',
];
const GATILHOS_VENDA = ['fechou', 'fechei', 'fechado', 'fechamos', 'vendi', 'venda', 'vendido'];

/** Palavras do gatilho que NÃO são pista de lead — removidas antes de sobrar a pista. */
const TODOS_OS_GATILHOS = [
  ...GATILHOS_NEGOCIACAO_PRIORITARIA, ...GATILHOS_PERDA, ...GATILHOS_NEGOCIACAO, ...GATILHOS_VENDA,
];

const MOTIVOS: Array<{ motivo: MotivoPerda; frases: string[] }> = [
  { motivo: 'ja_tem_plano', frases: ['ja tem plano', 'ja tem', 'ja possui', 'ja contratou', 'tem plano', 'ja fechou com outro', 'fechou com outro'] },
  { motivo: 'carencia', frases: ['carencia'] },
  { motivo: 'preco', frases: ['preco', 'caro', 'valor alto', 'achou caro', 'nao cabe no bolso', 'sem dinheiro', 'orcamento'] },
  { motivo: 'nao_respondeu', frases: ['nao respondeu', 'nao responde', 'sumiu', 'nao atende', 'nao retornou', 'parou de responder', 'sem resposta', 'nao deu retorno'] },
];

/** PURA. Categoria do motivo da perda. Sem frase reconhecida → 'outro' (o
 *  texto cru fica guardado: categoria errada é pior que "outro" honesto). */
export function categorizarMotivo(texto: string): MotivoPerda {
  const t = normalizar(texto);
  if (!t) return 'outro';
  for (const { motivo, frases } of MOTIVOS) {
    if (frases.some((f) => t.includes(f))) return motivo;
  }
  return 'outro';
}

export const MOTIVO_LEGIVEL: Record<MotivoPerda, string> = {
  preco: 'preço',
  carencia: 'carência',
  ja_tem_plano: 'já tem plano',
  nao_respondeu: 'não respondeu',
  outro: 'outro',
};

/** Teto de sanidade: venda acima disto é dedo escorregado, não plano de saúde. */
const VALOR_MAX_CENTS = 1_000_000_00;

/**
 * Piso: abaixo disto não é valor de venda, é outro número da frase lido no
 * lugar errado. Achado em revisão (12/10/2026): "fechou 2 vidas por 1200"
 * gravava R$ 2,00 e subia isso como valor da compra ao Google e à Meta. Na
 * dúvida o bot PERGUNTA o valor — pergunta custa uma mensagem, valor errado
 * contamina a medição de lucro.
 */
export const VALOR_MIN_CENTS = 10_00;

/** Número escrito como brasileiro escreve ("1.200,50", "1200.5", "1,2") → float. */
function numeroBrasileiro(bruto: string): number {
  const temPonto = bruto.includes('.');
  const temVirgula = bruto.includes(',');
  let normal = bruto;
  if (temPonto && temVirgula) {
    // "1.200,00" — ponto é milhar, vírgula é decimal.
    normal = bruto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    const depois = bruto.slice(bruto.lastIndexOf(',') + 1);
    normal = depois.length === 1 || depois.length === 2
      ? bruto.replace(',', '.')          // "1200,5" / "1200,50" — decimal
      : bruto.replace(/,/g, '');         // "1,200" — milhar
  } else if (temPonto) {
    const depois = bruto.slice(bruto.lastIndexOf('.') + 1);
    const umPontoSo = bruto.indexOf('.') === bruto.lastIndexOf('.');
    normal = umPontoSo && (depois.length === 1 || depois.length === 2)
      ? bruto                            // "1200.50" — decimal
      : bruto.replace(/\./g, '');        // "1.200" / "1.200.000" — milhar
  }
  return Number(normal);
}

/**
 * Número seguido de uma destas palavras NÃO é o valor da venda — é quantas
 * vidas, a idade, o prazo. "fechou 2 vidas por 1200" → o valor é o 1200.
 */
const NAO_E_VALOR = /^\s*(vidas?|pessoas?|benefici\w*|titular\w*|dependentes?|anos?|meses|mes|parcelas?|x\b)/;

/**
 * PURA. Valor em centavos escrito como brasileiro escreve: `1200`,
 * `1.200,00`, `1200,50`, `R$ 1.200`, `1200.50`, `3 mil`, `1,2k`.
 *
 * null quando não há número utilizável — e aí o bot pergunta o valor em vez
 * de gravar venda sem valor (que não ensina nada ao lance e é recusada pelo
 * check de `closed_sales.amount_brl > 0`).
 */
export function lerValorEmCentavos(texto: string): number | null {
  return acharValor(prepararTexto(texto))?.cents ?? null;
}

/** Normaliza e troca "r$" por DOIS espaços — mantém as posições, para o
 *  produto saber qual trecho da frase foi lido como valor. */
function prepararTexto(texto: string): string {
  return normalizar(texto).replace(/r\$/g, '  ');
}

interface ValorAchado {
  cents: number;
  /** Trecho de `t` lido como valor — o produto não pode reaproveitá-lo. */
  inicio: number;
  fim: number;
}

function acharValor(t: string): ValorAchado | null {
  const numeros = /\d[\d.,]*/g;
  let m: RegExpExecArray | null;
  while ((m = numeros.exec(t)) !== null) {
    const bruto = m[0].replace(/[.,]+$/, ''); // pontuação de fim de frase
    const resto = t.slice(m.index + m[0].length);
    if (NAO_E_VALOR.test(resto)) continue;
    // "amil 400", "unimed plus 2": número curto colado no nome do plano é o
    // MODELO do plano, não o valor (23/10/2026). Sem isto, "fechou amil 400
    // por 958,80" gravava venda de R$ 400. Sozinho ("fechou amil 400") é
    // ambíguo — o bot pergunta o valor em vez de chutar.
    if (/^\d{1,3}$/.test(bruto) && MODELO_DE_PLANO.has(ultimaPalavra(t.slice(0, m.index)))) continue;
    // "3 mil", "1,2k" — sem isto viravam R$ 3,00 e R$ 1,20.
    const multiplicador = /^\s*(mil\b|k\b)/.test(resto) ? 1000 : 1;
    const valor = numeroBrasileiro(bruto) * multiplicador;
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const cents = Math.round(valor * 100);
    return cents >= VALOR_MIN_CENTS && cents <= VALOR_MAX_CENTS
      ? { cents, inicio: m.index, fim: m.index + bruto.length }
      : null;
  }
  return null;
}

function ultimaPalavra(antes: string): string {
  return /([a-z]+)\W*$/.exec(antes)?.[1] ?? '';
}

// ── O que foi vendido ───────────────────────────────────────────────────────
//
// "fechou 958,80 hapvida individual" grava o valor E o produto (23/10/2026).
// Caso real: leads do grupo Adventista (Proasa) fechando Hapvida individual —
// sem o produto, o app não mostra "procurou X, fechou Y".
//
// Por VOCABULÁRIO, não por "o que sobrou da frase": o que sobra é a pista de
// QUAL lead ("fechou 1200 João"), e um nome lido como produto (ou o contrário)
// grava a venda no lead errado. Palavra fora da lista continua sendo pista —
// no pior caso o bot pergunta qual lead, nunca chuta. A lista é de plano de
// saúde (o nicho de quem usa o bot hoje); outro ramo registra sem produto,
// como antes.

/** Operadoras: abrem o produto e, seguidas de número curto, ele é o modelo.
 *  Fora de propósito: "Assim" e "Sul" (de Sul América) — são palavras comuns,
 *  e "fechou 1200 zona sul" viraria produto. "SulAmérica" junto entra. */
const OPERADORAS: Record<string, string> = {
  hapvida: 'Hapvida', samel: 'Samel', unimed: 'Unimed', amil: 'Amil', bradesco: 'Bradesco',
  sulamerica: 'SulAmérica', proasa: 'Proasa', notredame: 'NotreDame',
  intermedica: 'Intermédica', gndi: 'GNDI', porto: 'Porto', prevent: 'Prevent', golden: 'Golden',
  cassi: 'Cassi', geap: 'Geap', careplus: 'Care Plus', medsenior: 'MedSênior', allianz: 'Allianz',
  odontoprev: 'OdontoPrev',
};

/** Modalidades: também abrem o produto ("fechou 600 individual"). */
const MODALIDADES: Record<string, string> = {
  individual: 'individual', familiar: 'familiar', empresarial: 'empresarial', pme: 'PME',
  adesao: 'adesão', coletivo: 'coletivo', coletiva: 'coletiva', mei: 'MEI',
  odonto: 'odonto', odontologico: 'odontológico', dental: 'dental',
};

/** Só continuam um produto já aberto — sozinhas não querem dizer plano. */
const COMPLEMENTOS: Record<string, string> = {
  saude: 'Saúde', seguro: 'Seguro', cross: 'Cross', senior: 'Senior', america: 'América', dame: 'Dame',
  mix: 'Mix', plus: 'Plus', top: 'Top', flex: 'Flex', premium: 'Premium', smart: 'Smart', max: 'Max',
  nacional: 'nacional', regional: 'regional', estadual: 'estadual',
  enfermaria: 'enfermaria', apartamento: 'apartamento', apto: 'apto',
  copart: 'copart', coparticipacao: 'coparticipação', coparticipativo: 'coparticipativo',
};

/** Ligam duas partes do produto só quando a seguinte também é do produto:
 *  "por adesão", "com coparticipação" — e "por 958,80" não entra. */
const CONECTORES = new Set(['por', 'com', 'sem']);

/** Palavras depois das quais número curto é modelo do plano ("amil 400"). */
const MODELO_DE_PLANO = new Set([
  ...Object.keys(OPERADORAS), 'mix', 'plus', 'top', 'flex', 'premium', 'smart', 'max',
]);

const PRODUTO_MAX = 120; // teto de closed_sales.product

interface ProdutoAchado {
  texto: string;
  /** Trechos de `t` que compõem o produto — saem da pista do lead. */
  trechos: Array<[number, number]>;
}

function acharProduto(t: string, valor: ValorAchado | null): ProdutoAchado | null {
  const tokens = [...t.matchAll(/\S+/g)].map((m) => {
    const cru = m[0];
    const ini = m.index! + (cru.length - cru.replace(/^[^\w]+/, '').length);
    const nucleo = cru.replace(/^[^\w]+|[^\w]+$/g, '');
    return {
      nucleo, ini, fim: ini + nucleo.length,
      ehValor: Boolean(valor && m.index! < valor.fim && m.index! + cru.length > valor.inicio),
    };
  });
  const abre = (n: string) => n in OPERADORAS || n in MODALIDADES;
  const continua = (n: string) => abre(n) || n in COMPLEMENTOS;

  const inicio = tokens.findIndex((tk) => !tk.ehValor && abre(tk.nucleo));
  if (inicio < 0) return null;

  const partes: string[] = [];
  const trechos: Array<[number, number]> = [];
  let anterior = '';
  for (let i = inicio; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.ehValor) continue; // "hapvida 958,80 individual": o valor no meio não corta o produto
    const n = tk.nucleo;
    // "unimed plus 2 por 900 com coparticipação": o "por" do valor também
    // não corta o produto — senão "coparticipação" sobrava como nome de lead.
    if (CONECTORES.has(n) && tokens[i + 1]?.ehValor) continue;
    const proximo = tokens.slice(i + 1).find((x) => !x.ehValor)?.nucleo ?? '';
    let rotulo: string | null = null;
    if (continua(n)) rotulo = OPERADORAS[n] ?? MODALIDADES[n] ?? COMPLEMENTOS[n];
    else if (CONECTORES.has(n) && continua(proximo)) rotulo = n;
    // Número do modelo só entra quando OUTRO número foi o valor: sozinho é
    // ambíguo (acharValor também o recusou) e não vira nem valor nem produto.
    else if (/^\d{1,3}$/.test(n) && MODELO_DE_PLANO.has(anterior) && valor) rotulo = n;
    if (rotulo === null) break;
    partes.push(rotulo);
    trechos.push([tk.ini, tk.fim]);
    anterior = n;
  }
  const texto = partes.join(' ');
  return {
    texto: (texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1)).slice(0, PRODUTO_MAX),
    trechos,
  };
}

/**
 * PURA. O que foi vendido, quando a mensagem diz: "fechou 958,80 hapvida
 * individual" → "Hapvida individual". null quando não há palavra de plano —
 * "fechou 958,80" continua uma venda completa, só sem produto.
 */
export function lerProduto(texto: string): string | null {
  const t = prepararTexto(texto);
  return acharProduto(t, acharValor(t))?.texto ?? null;
}

/** Tira o produto do texto antes de extrair a pista: "hapvida individual"
 *  não é nome de lead, e lido como nome faria o bot perguntar "qual deles?"
 *  mesmo com um lead aberto só. */
function semOsTrechos(t: string, trechos: Array<[number, number]>): string {
  let saida = t;
  for (const [ini, fim] of trechos) saida = saida.slice(0, ini) + ' '.repeat(fim - ini) + saida.slice(fim);
  return saida;
}

/** Sobra da mensagem depois de tirar gatilho, valor e pontuação: a pista de
 *  QUAL lead o vendedor quis dizer ("fechou 1200 João" → "joao"). */
function extrairPista(texto: string): string {
  let t = normalizar(texto);
  for (const g of TODOS_OS_GATILHOS) t = t.split(g).join(' ');
  for (const { frases } of MOTIVOS) for (const f of frases) t = t.split(f).join(' ');
  return t
    .replace(/r\$/g, ' ')
    .replace(/\b(do|da|de|o|a|com|para|pro|em|no|na|lead|cliente|reais)\b/g, ' ')
    .replace(/[^\d\w\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * PURA. O que o vendedor quis dizer. null = não é resposta de desfecho
 * (mensagem solta do vendedor não vira registro nenhum).
 *
 * Mensagem longa é recusada de propósito: o vendedor conversando sobre outro
 * assunto pode conter "fechou" numa frase ("o escritório fechou mais cedo") —
 * desfecho é resposta curta.
 */
export const TAMANHO_MAX_RESPOSTA = 160;

export function interpretarRespostaDoVendedor(texto: string): RespostaDoVendedor | null {
  const cru = String(texto ?? '').trim();
  if (!cru || cru.length > TAMANHO_MAX_RESPOSTA) return null;
  const t = normalizar(cru);
  const pista = extrairPista(cru);

  if (GATILHOS_NEGOCIACAO_PRIORITARIA.some((g) => t.includes(g))) {
    return { resultado: 'negociando', pista };
  }
  if (GATILHOS_PERDA.some((g) => t.includes(g))) {
    const motivoTexto = cru;
    return { resultado: 'perdido', motivo: categorizarMotivo(cru), motivoTexto, pista };
  }
  if (GATILHOS_NEGOCIACAO.some((g) => t.includes(g))) {
    return { resultado: 'negociando', pista };
  }
  if (GATILHOS_VENDA.some((g) => t.includes(g))) {
    const preparado = prepararTexto(cru);
    const valor = acharValor(preparado);
    const produto = acharProduto(preparado, valor);
    return {
      resultado: 'venda',
      ...(valor ? { valorCents: valor.cents } : {}),
      ...(produto ? { produto: produto.texto } : {}),
      pista: produto ? extrairPista(semOsTrechos(preparado, produto.trechos)) : pista,
    };
  }
  return null;
}

// ── A QUAL lead a resposta se refere ────────────────────────────────────────

export interface LeadAberto {
  id: string;
  leadPhone: string;
  nome: string | null;
  /** Mais recente primeiro é responsabilidade de quem consulta. */
  handoffEm: Date | null;
}

export interface EscolhaDeLead {
  /** O lead identificado — só quando NÃO há dúvida. */
  lead?: LeadAberto;
  /** Quando há dúvida: os candidatos a perguntar de volta (mais recente 1º). */
  candidatos?: LeadAberto[];
}

/** Telefone que aparece na linha "Contato: …" do nosso próprio aviso. */
export function telefoneDoAvisoCitado(citacao: string | null | undefined): string | null {
  if (!citacao) return null;
  const m = String(citacao).match(/contato:\s*([+\d][\d\s().-]{7,})/i);
  return m ? m[1].trim() : null;
}

const MAX_CANDIDATOS = 3;

/**
 * Palavras que sobram na pista e NÃO são nome de lead. Sem esta lista,
 * "fechou 1200 hoje" com um lead aberto viraria pergunta à toa — e com ela
 * "fechou 1200 Pedro" (Pedro não está entre os abertos) vira pergunta, não
 * venda gravada em quem estiver aberto.
 */
const NAO_E_NOME = new Set([
  'hoje', 'ontem', 'agora', 'ainda', 'amanha', 'depois', 'semana', 'mes', 'mensal', 'anual', 'ano', 'anos',
  'ele', 'ela', 'dele', 'dela', 'esse', 'essa', 'este', 'esta', 'aquele', 'aquela',
  'cliente', 'plano', 'planos', 'empresa', 'cnpj', 'familia', 'titular', 'vida', 'vidas', 'pessoa', 'pessoas',
  'reais', 'real', 'mil', 'valor', 'total', 'por', 'pra', 'pro', 'que', 'sim', 'nao', 'blz', 'beleza',
  'obrigado', 'obrigada', 'top', 'show', 'boa', 'bom', 'dia', 'tarde', 'noite', 'tem', 'mais', 'menos',
  'barato', 'cotacao', 'proposta', 'contrato', 'assinou', 'assinado', 'pagou', 'pago', 'boleto', 'pix',
  'cartao', 'primeira', 'parcela', 'graças', 'gracas', 'deus', 'aqui', 'ja', 'tudo', 'certo',
]);

function palavrasDeNome(pista: string): string[] {
  return normalizar(pista)
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !NAO_E_NOME.has(p));
}

const porTelefone = (leads: LeadAberto[], chave: string | null) =>
  leads.filter((a) => chave && chaveDoTelefone(a.leadPhone) === chave);

/**
 * PURA. Qual lead o vendedor respondeu — na ordem: citação do WhatsApp, pista
 * no texto (telefone ou nome que casa com UM só), lead aberto único.
 *
 * Nunca chuta: com dois leads abertos e nada que desempate, devolve
 * `candidatos` para o bot perguntar de volta. Chutar aqui grava a venda no
 * lead errado e sobe a conversão com o clique errado — estraga o dado que o
 * cliente paga para ter.
 *
 * ⚠️ O atalho "um lead aberto só → é ele" vem POR ÚLTIMO (achado em revisão,
 * 12/10/2026). Antes vinha primeiro: o vendedor citava o aviso do João (já
 * vendido) ou escrevia "fechou 1200 Pedro", e a venda caía na Maria, a única
 * aberta. Citação ou pista que apontam para OUTRO lead vencem o atalho.
 *
 * `exigirIdentificacao` desliga o atalho — para listas em que "o único" não
 * quer dizer nada (ex.: leads já resolvidos).
 */
export function escolherLead(entrada: {
  citacao?: string | null;
  pista?: string;
  abertos: LeadAberto[];
  exigirIdentificacao?: boolean;
}): EscolhaDeLead {
  const abertos = entrada.abertos;
  if (abertos.length === 0) return {};
  const candidatos = { candidatos: abertos.slice(0, MAX_CANDIDATOS) };

  const citado = telefoneDoAvisoCitado(entrada.citacao);
  if (citado) {
    const chave = chaveDoTelefone(citado);
    const achados = porTelefone(abertos, chave);
    if (achados.length === 1) return { lead: achados[0] };
    // Citou o aviso de um lead que NÃO está nesta lista: é outro lead. Nada
    // de cair no único aberto.
    if (chave) return {};
  }

  const pista = normalizar(entrada.pista ?? '');
  const digitos = pista.replace(/\D/g, '');
  if (digitos.length >= 8) {
    const chave = chaveDoTelefone(digitos);
    const achados = porTelefone(abertos, chave);
    if (achados.length === 1) return { lead: achados[0] };
    if (chave && achados.length === 0) return {};
  }

  const palavras = palavrasDeNome(pista);
  if (palavras.length) {
    const porNome = abertos.filter((a) => {
      const nome = normalizar(a.nome ?? '');
      return Boolean(nome) && palavras.some((p) => nome.includes(p));
    });
    if (porNome.length === 1) return { lead: porNome[0] };
    // Nome que não casa com ninguém (ou com vários): pergunta. Nunca o único.
    return entrada.exigirIdentificacao ? {} : candidatos;
  }

  if (abertos.length === 1 && !entrada.exigirIdentificacao) return { lead: abertos[0] };
  return entrada.exigirIdentificacao ? {} : candidatos;
}

/** PURA. Resolve a resposta do vendedor à pergunta "qual deles?": o número da
 *  lista (1, 2, 3) ou o nome/telefone de um dos candidatos. */
export function escolherEntreCandidatos(texto: string, candidatos: LeadAberto[]): LeadAberto | null {
  const t = normalizar(texto);
  if (!t || !candidatos.length) return null;
  const soDigitos = t.replace(/\D/g, '');
  // "1" / "2" / "3" — só quando o número sozinho é a mensagem inteira, senão
  // "fechou 1200" selecionaria o candidato 1200.
  if (/^[1-9]$/.test(t)) {
    const i = Number(t) - 1;
    return candidatos[i] ?? null;
  }
  if (soDigitos.length >= 8) {
    const chave = chaveDoTelefone(soDigitos);
    const achado = candidatos.filter((c) => chave && chaveDoTelefone(c.leadPhone) === chave);
    if (achado.length === 1) return achado[0];
  }
  const palavras = palavrasDeNome(t);
  const porNome = candidatos.filter((c) => {
    const nome = normalizar(c.nome ?? '');
    return Boolean(nome) && palavras.some((p) => nome.includes(p));
  });
  return porNome.length === 1 ? porNome[0] : null;
}

// ── Lembrete de retorno (dias 2, 5 e 10) ────────────────────────────────────

/** Dias desde o handoff em que o vendedor é cobrado. Depois do 3º, silêncio —
 *  cobrar para sempre é a receita de virar ruído que o vendedor ignora. */
export const DIAS_DE_LEMBRETE = [2, 5, 10];

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ConversaParaLembrete {
  state: string;
  label: string | null;
  resultado: string | null;
  /** Base do relógio: o handoff (ou a data em que virou "em negociação"). */
  handoffEm: Date | null;
  lembretesEnviados: number;
  ultimoLembreteEm?: Date | null;
}

/** Nunca dois lembretes do mesmo lead em menos que isto. */
const INTERVALO_MIN_LEMBRETE_MS = 20 * 60 * 60 * 1000;

/**
 * PURA. Qual lembrete está devido agora (1, 2 ou 3), ou null.
 *
 * Só lead QUENTE já entregue ao vendedor e SEM desfecho. "em negociação" não
 * é desfecho: ele rezera o relógio (ver resultado.service.ts), então aqui a
 * conversa com `resultado = 'negociando'` segue elegível.
 */
export function lembreteDevido(c: ConversaParaLembrete, agora: Date): number | null {
  if (c.state !== 'handoff') return null;
  if (c.label !== 'QUENTE') return null;
  if (c.resultado === 'venda' || c.resultado === 'perdido') return null;
  if (!c.handoffEm) return null;
  if (c.lembretesEnviados >= DIAS_DE_LEMBRETE.length) return null;
  if (c.ultimoLembreteEm && agora.getTime() - c.ultimoLembreteEm.getTime() < INTERVALO_MIN_LEMBRETE_MS) {
    return null;
  }
  const dias = (agora.getTime() - c.handoffEm.getTime()) / DIA_MS;
  // O lembrete MAIS ADIANTADO já vencido, não o próximo da fila (achado em
  // revisão): depois de bot desligado ou fora do ar por dias, os três
  // atrasados saíam em três horas seguidas para o mesmo lead. Um basta.
  let devido: number | null = null;
  for (let i = c.lembretesEnviados; i < DIAS_DE_LEMBRETE.length; i++) {
    if (dias >= DIAS_DE_LEMBRETE[i]) devido = i + 1;
  }
  return devido;
}

// ── Horário de atendimento ──────────────────────────────────────────────────

export interface JanelaDeAtendimento {
  /** Hora local de Manaus em que pode começar a mandar (inclusiva). */
  inicio: number;
  /** Hora local em que para (exclusiva). */
  fim: number;
  /** Dias da semana permitidos (0 = domingo). */
  dias: number[];
}

/** Janela usada quando a config não diz, ou diz de um jeito que não dá para
 *  ler. Conservadora de propósito: errar para o lado de não acordar ninguém. */
export const JANELA_PADRAO: JanelaDeAtendimento = { inicio: 9, fim: 18, dias: [1, 2, 3, 4, 5, 6] };

/**
 * PURA. Lê o `businessHours` da config, que é texto livre escrito pelo
 * cliente ("Seg a Sex, 8h às 18h"). O que não for reconhecido cai no padrão —
 * nunca numa janela mais larga do que o padrão por adivinhação.
 */
export function janelaDeAtendimento(businessHours: string | null | undefined): JanelaDeAtendimento {
  const t = normalizar(businessHours ?? '');
  if (!t) return JANELA_PADRAO;

  let dias = JANELA_PADRAO.dias;
  if (/\b(todos os dias|todo dia|diariamente|24\s*h|24\/7)\b/.test(t)) dias = [0, 1, 2, 3, 4, 5, 6];
  else if (/(seg\w*)\s*(a|as|ate|-|\/)\s*(sab\w*)/.test(t)) dias = [1, 2, 3, 4, 5, 6];
  else if (/(seg\w*)\s*(a|as|ate|-|\/)\s*(sex\w*)/.test(t)) dias = [1, 2, 3, 4, 5];

  // "8h às 18h", "08:00-18:00", "das 8 as 18"
  const m = t.match(/(\d{1,2})\s*(?::\d{2})?\s*h?\s*(?:as|a|ate|-|\/)\s*(\d{1,2})\s*(?::\d{2})?\s*h?/);
  let inicio = JANELA_PADRAO.inicio;
  let fim = JANELA_PADRAO.fim;
  if (m) {
    const de = Number(m[1]);
    const ate = Number(m[2]);
    if (Number.isInteger(de) && Number.isInteger(ate) && de >= 0 && ate <= 24 && de < ate) {
      inicio = de;
      fim = ate;
    }
  }
  return { inicio, fim, dias };
}

/** Hora e dia da semana em Manaus (UTC-4 fixo, sem horário de verão). */
export function agoraEmManaus(agora: Date): { hora: number; diaDaSemana: number } {
  const d = new Date(agora.getTime() - 4 * 60 * 60 * 1000);
  return { hora: d.getUTCHours(), diaDaSemana: d.getUTCDay() };
}

/** PURA. Pode mandar mensagem ao vendedor agora? */
export function dentroDoAtendimento(businessHours: string | null | undefined, agora: Date): boolean {
  const janela = janelaDeAtendimento(businessHours);
  const { hora, diaDaSemana } = agoraEmManaus(agora);
  return janela.dias.includes(diaDaSemana) && hora >= janela.inicio && hora < janela.fim;
}

// ── Textos que o vendedor recebe ────────────────────────────────────────────

/** Como o lead é chamado nas mensagens: o nome quando existe, senão o número. */
export function comoChamarOLead(lead: { nome?: string | null; leadPhone: string }): string {
  const nome = (lead.nome ?? '').trim();
  if (nome) return nome;
  const d = lead.leadPhone.replace(/\D/g, '');
  return d.length >= 4 ? `lead …${d.slice(-4)}` : 'o lead';
}

export function reais(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── O aviso que o vendedor recebe ───────────────────────────────────────────

/**
 * Última linha do aviso de lead (12/10/2026): ensina o vendedor a responder.
 *
 * Sem ela o registro pelo WhatsApp existia e ninguém usava — o aviso parecia
 * só um aviso. "Responda ESTE aviso" é de propósito: a citação carrega a
 * linha "Contato:", e é ela que diz sem dúvida a qual lead a resposta se
 * refere (ver escolherLead), mesmo com vários leads abertos ao mesmo tempo.
 * Os exemplos são exatamente as três formas que interpretarRespostaDoVendedor
 * entende.
 */
export const LINHA_COMO_RESPONDER =
  '👉 Quando tiver o resultado, responda ESTE aviso: fechou 1200 · perdeu preço · em negociação';

/** PURA. Texto do aviso de lead qualificado enviado ao vendedor. */
export function montarAvisoAoVendedor(lead: string, resumo: string, ensaio = false): string {
  const teste = ensaio ? '🧪 TESTE — este aviso NÃO foi enviado ao vendedor.\n' : '';
  const corpo = resumo.trim() ? `\n${resumo.trim()}` : '';
  return `${teste}🔔 Novo lead qualificado!\nContato: ${lead}${corpo}\n\n${LINHA_COMO_RESPONDER}`;
}
