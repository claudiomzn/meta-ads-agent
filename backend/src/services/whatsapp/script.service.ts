// Modo ROTEIRO FIXO — o bot fala SÓ as palavras que o cliente escreveu.
//
// ⭐ A diferença para o `qualification.service.ts` é a única que importa:
// lá a IA ESCREVE cada mensagem, aqui a IA nunca escreve nada. O roteiro fala
// (texto literal da config, palavra por palavra) e a IA só LÊ a resposta do
// lead para preencher um campo. Nada que a IA devolve é enviado ao cliente.
//
// Isso veio de um problema real (24/09/2026, Amazon Corretora): o bot gerava
// conversa fora de contexto com o cliente. Não era regra desobedecida — era o
// desenho: toda resposta era uma chamada de IA solta, com as perguntas
// entrando no prompt apenas como "sugeridas", e até 8 mensagens livres por
// conversa. Quem quer um atendente de recado não pode receber um vendedor
// autônomo.
//
// Separar QUEM FALA de QUEM ENTENDE preserva o orçamento automático (que
// precisa de tipo + idades estruturados) sem devolver o microfone à IA.

import Anthropic from '@anthropic-ai/sdk';
import { runWithAiBudget } from '../../middleware/aiBudget.middleware.js';

// Leitura de campo é tarefa mínima — o modelo mais barato basta, e aqui ele
// nem redige: devolve um valor ou null.
const MODEL = 'claude-haiku-4-5';

/** Campos que um passo do roteiro pode coletar. `null` = pergunta só para o
 *  vendedor ler, sem estruturação (nada a extrair). */
export type CampoDoRoteiro = 'tipo' | 'vidas' | 'idades' | 'plano_atual' | 'urgencia';

export interface PassoDoRoteiro {
  /** Texto EXATO enviado ao lead. Nunca reescrito. */
  pergunta: string;
  campo: CampoDoRoteiro | null;
}

/** O que o roteiro juntou até agora. Campo ausente = ainda não perguntado;
 *  campo `null` = perguntado e o lead não respondeu (desistimos depois de 1
 *  repetição). */
export interface DadosDoRoteiro {
  tipo?: 'pf' | 'cnpj' | null;
  vidas?: number | null;
  idades?: number[] | null;
  plano_atual?: string | null;
  urgencia?: 'contratar' | 'pesquisando' | null;
}

const CAMPOS_VALIDOS: CampoDoRoteiro[] = ['tipo', 'vidas', 'idades', 'plano_atual', 'urgencia'];

/**
 * PURO. Lê `scriptSteps` da config (JSON vindo do banco) como entrada externa.
 *
 * Passo sem `pergunta` utilizável é DESCARTADO, não corrigido: um passo vazio
 * viraria uma mensagem em branco enviada ao cliente, que é pior do que uma
 * pergunta a menos.
 */
export function lerRoteiro(raw: unknown): PassoDoRoteiro[] {
  if (!Array.isArray(raw)) return [];
  const passos: PassoDoRoteiro[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const pergunta = typeof o.pergunta === 'string' ? o.pergunta.trim() : '';
    if (!pergunta) continue;
    const campoRaw = typeof o.campo === 'string' ? o.campo.trim().toLowerCase() : '';
    const campo = (CAMPOS_VALIDOS as string[]).includes(campoRaw) ? (campoRaw as CampoDoRoteiro) : null;
    passos.push({ pergunta, campo });
  }
  return passos;
}

/** PURO. O roteiro acabou? */
export function roteiroTerminou(passos: PassoDoRoteiro[], passoAtual: number): boolean {
  return passoAtual >= passos.length;
}

/**
 * PURO. QUENTE só quando o lead disse que pretende contratar.
 *
 * ⭐ Este rótulo decide se a conversão de lead qualificado sobe para o Google
 * e para o Meta — é o sinal que o lance inteligente usa para aprender. Chamar
 * de QUENTE quem respondeu "só pesquisando" é exatamente o erro que o
 * AdsGenius passou meses combatendo: afogar o sinal bom em volume fácil.
 * Quem não respondeu a pergunta (`undefined`/`null`) também não é QUENTE —
 * ausência de sinal não é sinal positivo.
 */
export function rotuloDoLead(dados: DadosDoRoteiro): 'QUENTE' | 'FRIO' {
  return dados.urgencia === 'contratar' ? 'QUENTE' : 'FRIO';
}

const ROTULO_CAMPO: Record<CampoDoRoteiro, string> = {
  tipo: 'Tipo',
  vidas: 'Pessoas',
  idades: 'Idades',
  plano_atual: 'Plano hoje',
  urgencia: 'Intenção',
};

function valorLegivel(campo: CampoDoRoteiro, valor: unknown): string {
  if (valor === null || valor === undefined) return 'não respondeu';
  if (campo === 'tipo') return valor === 'cnpj' ? 'Empresa (CNPJ)' : 'Pessoa física/família';
  if (campo === 'urgencia') return valor === 'contratar' ? 'quer contratar nos próximos dias' : 'só pesquisando';
  if (campo === 'idades' && Array.isArray(valor)) return valor.join(', ');
  return String(valor);
}

/**
 * PURO. Resumo que vai para o WhatsApp do vendedor.
 *
 * Mostra explicitamente o que o lead NÃO respondeu. O vendedor precisa saber
 * onde a conversa ficou capenga antes de ligar — sem isso ele repete uma
 * pergunta que o lead já respondeu, ou assume um dado que ninguém deu.
 */
export function montarResumoDoRoteiro(passos: PassoDoRoteiro[], dados: DadosDoRoteiro): string {
  const linhas: string[] = [];
  for (const passo of passos) {
    if (!passo.campo) continue;
    if (!(passo.campo in dados)) continue;
    linhas.push(`${ROTULO_CAMPO[passo.campo]}: ${valorLegivel(passo.campo, dados[passo.campo])}`);
  }
  return linhas.join('\n');
}

/**
 * PURO. Converte o que o roteiro coletou para o formato que a cotação
 * automática valida (ver cotacao.integration.ts).
 *
 * Não valida nada aqui de propósito — `extrairDadosParaCotacao` é quem trata
 * isto como entrada externa, e ter DOIS validadores é o jeito clássico de as
 * duas regras divergirem em silêncio.
 */
export function dadosParaCotacao(dados: DadosDoRoteiro): Record<string, unknown> {
  return {
    tipo: dados.tipo ?? null,
    vidas: dados.vidas ?? null,
    idades: dados.idades ?? [],
    operadora: null,
  };
}

const INSTRUCAO_POR_CAMPO: Record<CampoDoRoteiro, string> = {
  tipo:
    '"pf" se o plano é para a pessoa, a família ou dependentes; "cnpj" se é para uma empresa, MEI ou funcionários.',
  vidas: 'o número INTEIRO de pessoas que vão entrar no plano.',
  idades:
    'a lista de idades em ANOS, na ordem em que o lead falou. Se ele deu ano de nascimento, converta para idade. Nunca estime uma idade que ele não informou.',
  plano_atual:
    'o nome do plano/operadora que o lead tem hoje. Se ele disse que NÃO tem plano nenhum, isso É uma resposta: devolva a string "nenhum".',
  urgencia:
    '"contratar" se o lead demonstrou querer fechar nos próximos dias; "pesquisando" se ele disse que está só olhando, comparando ou sem pressa.',
};

function systemPromptDeLeitura(passo: PassoDoRoteiro): string {
  return `Você NÃO conversa com ninguém. Você lê a resposta de uma pessoa e extrai UM dado. Sua saída nunca é mostrada a ela.

A pergunta feita foi: "${passo.pergunta}"

Extraia: ${INSTRUCAO_POR_CAMPO[passo.campo as CampoDoRoteiro]}

Se a pessoa NÃO respondeu a essa pergunta — fez outra pergunta, desviou do assunto, mandou saudação, ou a resposta não dá para aproveitar — devolva null. Nunca deduza, nunca complete, nunca invente um valor plausível: null é a resposta certa quando o dado não está ali.

Responda SOMENTE com JSON válido, sem markdown, exatamente neste formato:
{"valor": <o valor extraído, ou null>}`;
}

/**
 * PURO. Grava o valor lido no campo, sem mutar o objeto de entrada.
 *
 * Existe porque `dados[campo] = valor` com `campo` de tipo união faz o
 * TypeScript exigir a INTERSEÇÃO de todos os tipos possíveis (ou seja, nada
 * serve). O cast fica preso aqui dentro, numa função de uma linha coberta por
 * teste, em vez de espalhado pelo orquestrador.
 *
 * `null` é gravado de propósito quando o lead não respondeu — é diferente de
 * "ainda não perguntamos" (campo ausente), e o resumo do vendedor usa essa
 * diferença.
 */
export function gravarCampo(dados: DadosDoRoteiro, campo: CampoDoRoteiro, valor: unknown): DadosDoRoteiro {
  const copia: Record<string, unknown> = { ...dados };
  copia[campo] = valor ?? null;
  return copia as DadosDoRoteiro;
}

/** PURO. Aceita só o que o campo comporta — a IA é entrada externa. */
export function validarValor(campo: CampoDoRoteiro, valor: unknown): DadosDoRoteiro[CampoDoRoteiro] | null {
  if (valor === null || valor === undefined) return null;
  if (campo === 'tipo') {
    const t = String(valor).toLowerCase();
    return t === 'pf' || t === 'cnpj' ? t : null;
  }
  if (campo === 'vidas') {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 && n <= 99 ? n : null;
  }
  if (campo === 'idades') {
    if (!Array.isArray(valor)) return null;
    const idades = valor.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 120);
    return idades.length ? idades : null;
  }
  if (campo === 'urgencia') {
    const u = String(valor).toLowerCase();
    return u === 'contratar' || u === 'pesquisando' ? u : null;
  }
  // plano_atual: texto livre do lead, curto e sem lixo.
  const texto = String(valor).trim().slice(0, 60);
  return texto || null;
}

function extrairJson(text: string): string {
  const bloco = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (bloco) return bloco[1].trim();
  const i = text.indexOf('{');
  const f = text.lastIndexOf('}');
  return i !== -1 && f > i ? text.slice(i, f + 1) : text.trim();
}

/**
 * Lê a resposta do lead para UM passo. Devolve o valor ou `null` (não
 * respondeu / não deu para aproveitar).
 *
 * ⚠️ Falha de IA devolve `null`, nunca lança: o roteiro precisa continuar
 * andando mesmo com a Anthropic fora do ar. O custo de errar para `null` é
 * repetir a pergunta uma vez e seguir — barato. O custo de lançar seria o
 * lead ficar sem resposta nenhuma.
 */
export async function lerResposta(
  backendUserId: string,
  passo: PassoDoRoteiro,
  textoDoLead: string,
): Promise<DadosDoRoteiro[CampoDoRoteiro] | null> {
  if (!passo.campo) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const resp = await runWithAiBudget(backendUserId, 'agent_quick', () =>
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
        model: MODEL,
        max_tokens: 200,
        system: [{ type: 'text', text: systemPromptDeLeitura(passo) }],
        messages: [{ role: 'user', content: textoDoLead }],
      }));
    const bloco = resp.content.find((b) => b.type === 'text');
    const texto = bloco && bloco.type === 'text' ? bloco.text : '';
    const parsed = JSON.parse(extrairJson(texto)) as { valor?: unknown };
    return validarValor(passo.campo, parsed.valor);
  } catch (e) {
    console.warn('[whatsapp:roteiro] não consegui ler a resposta do lead:', e instanceof Error ? e.message : e);
    return null;
  }
}
