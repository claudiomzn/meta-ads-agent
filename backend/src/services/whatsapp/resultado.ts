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

// As três portas. Ordem importa na leitura: "perdeu" e "em negociação" são
// checados ANTES de "fechou" porque "nao fechou" é perda, não venda.
const GATILHOS_PERDA = [
  'perdeu', 'perdi', 'perdido', 'perdemos',
  'nao fechou', 'nao fechei', 'nao vai fechar', 'nao quis', 'desistiu', 'recusou',
];
const GATILHOS_NEGOCIACAO = [
  'em negociacao', 'negociacao', 'negociando', 'negocia',
  'em andamento', 'analisando', 'pensando', 'vai pensar', 'aguardando',
];
const GATILHOS_VENDA = ['fechou', 'fechei', 'fechado', 'fechamos', 'vendi', 'venda', 'vendido'];

/** Palavras do gatilho que NÃO são pista de lead — removidas antes de sobrar a pista. */
const TODOS_OS_GATILHOS = [...GATILHOS_PERDA, ...GATILHOS_NEGOCIACAO, ...GATILHOS_VENDA];

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
 * PURA. Valor em centavos escrito como brasileiro escreve: `1200`,
 * `1.200,00`, `1200,50`, `R$ 1.200`, `1200.50`.
 *
 * null quando não há número utilizável — e aí o bot pergunta o valor em vez
 * de gravar venda sem valor (que não ensina nada ao lance e é recusada pelo
 * check de `closed_sales.amount_brl > 0`).
 */
export function lerValorEmCentavos(texto: string): number | null {
  const t = normalizar(texto).replace(/r\$/g, ' ');
  // Primeiro grupo que começa com dígito e segue com dígitos, ponto ou vírgula.
  const bruto = t.match(/\d[\d.,]*/)?.[0];
  if (!bruto) return null;
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
  const valor = Number(normal);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const cents = Math.round(valor * 100);
  return cents > 0 && cents <= VALOR_MAX_CENTS ? cents : null;
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

  if (GATILHOS_PERDA.some((g) => t.includes(g))) {
    const motivoTexto = cru;
    return { resultado: 'perdido', motivo: categorizarMotivo(cru), motivoTexto, pista };
  }
  if (GATILHOS_NEGOCIACAO.some((g) => t.includes(g))) {
    return { resultado: 'negociando', pista };
  }
  if (GATILHOS_VENDA.some((g) => t.includes(g))) {
    const valorCents = lerValorEmCentavos(cru);
    return valorCents === null
      ? { resultado: 'venda', pista }
      : { resultado: 'venda', valorCents, pista };
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
 * PURA. Qual lead o vendedor respondeu — na ordem: citação do WhatsApp, pista
 * no texto (telefone ou nome que casa com UM só), lead aberto único.
 *
 * Nunca chuta: com dois leads abertos e nada que desempate, devolve
 * `candidatos` para o bot perguntar de volta. Chutar aqui grava a venda no
 * lead errado e sobe a conversão com o clique errado — estraga o dado que o
 * cliente paga para ter.
 */
export function escolherLead(entrada: {
  citacao?: string | null;
  pista?: string;
  abertos: LeadAberto[];
}): EscolhaDeLead {
  const abertos = entrada.abertos;
  if (abertos.length === 0) return {};
  if (abertos.length === 1) return { lead: abertos[0] };

  const citado = telefoneDoAvisoCitado(entrada.citacao);
  if (citado) {
    const chave = chaveDoTelefone(citado);
    const porCitacao = abertos.filter((a) => chave && chaveDoTelefone(a.leadPhone) === chave);
    if (porCitacao.length === 1) return { lead: porCitacao[0] };
  }

  const pista = normalizar(entrada.pista ?? '');
  if (pista) {
    const digitos = pista.replace(/\D/g, '');
    if (digitos.length >= 8) {
      const chave = chaveDoTelefone(digitos);
      const porNumero = abertos.filter((a) => chave && chaveDoTelefone(a.leadPhone) === chave);
      if (porNumero.length === 1) return { lead: porNumero[0] };
    }
    // Nome: cada palavra da pista com 3+ letras que apareça no nome do lead.
    const palavras = pista.split(/\s+/).filter((p) => p.length >= 3 && !/^\d+$/.test(p));
    if (palavras.length) {
      const porNome = abertos.filter((a) => {
        const nome = normalizar(a.nome ?? '');
        return Boolean(nome) && palavras.some((p) => nome.includes(p));
      });
      if (porNome.length === 1) return { lead: porNome[0] };
    }
  }

  return { candidatos: abertos.slice(0, MAX_CANDIDATOS) };
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
  const palavras = t.split(/\s+/).filter((p) => p.length >= 3 && !/^\d+$/.test(p));
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
}

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
  const passo = c.lembretesEnviados;
  if (passo >= DIAS_DE_LEMBRETE.length) return null;
  const dias = (agora.getTime() - c.handoffEm.getTime()) / DIA_MS;
  return dias >= DIAS_DE_LEMBRETE[passo] ? passo + 1 : null;
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
