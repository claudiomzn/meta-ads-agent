// "Criar roteiro com IA para o meu negócio" (Luiz, 15/10/2026).
//
// A IA não fala com o lead (ver roteiro.efetivo.ts) — mas pode ESCREVER o
// rascunho do roteiro, que o cliente revisa e salva. Nasceu de um aviso do
// Luiz: "cuidado, vamos trabalhar com muitos outros ramos" — o único atalho
// que existia era o roteiro pronto de plano de saúde.
//
// O que sai daqui é rascunho: nada é salvo nem enviado ao cliente. Mesmo
// assim o texto é CONFERIDO antes de voltar à tela, porque o cliente tende a
// salvar sem ler — e o roteiro vai palavra por palavra ao lead:
//   • 2 a 6 perguntas, cada uma com até 220 caracteres;
//   • nenhum preço ("R$") — a IA não promete valor que o dono não deu;
//   • a pergunta de urgência sempre presente: é ela que marca QUENTE/FRIO e
//     faz a conversão subir ao Google e à Meta;
//   • os campos de plano de saúde (tipo, vidas, idades, plano atual) só em
//     negócio de plano de saúde — fora dele não há cotação para alimentar.

import Anthropic from '@anthropic-ai/sdk';
import type { CampoDoRoteiro, PassoDoRoteiro } from './script.service.js';
import { PERGUNTA_DE_URGENCIA } from './roteiro.efetivo.js';

const MODEL = 'claude-sonnet-4-6';

export interface NegocioParaRoteiro {
  businessName: string;
  product: string;
  region?: string | null;
}

export interface RoteiroSugerido {
  intro: string;
  passos: PassoDoRoteiro[];
  encerramento: string;
}

const LIMITE_PERGUNTA = 220;
const LIMITE_FRASE = 300;

/** Plano de saúde é o único ramo com cotação automática — só ele usa os campos estruturados. */
export function ehPlanoDeSaude(produto: string): boolean {
  const t = produto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /plano[s]? de saude|plano odontologico|convenio medico|seguro saude/.test(t);
}

export function promptDoRoteiro(n: NegocioParaRoteiro): string {
  const saude = ehPlanoDeSaude(n.product);
  const campos = saude
    ? `- "tipo": pessoa física/família ou empresa (CNPJ)
- "vidas": quantas pessoas
- "idades": idade de cada pessoa
- "plano_atual": plano que já tem hoje
- "urgencia": quer contratar logo ou está só pesquisando`
    : `- "urgencia": quer contratar/comprar logo ou está só pesquisando`;
  return `Você escreve o ROTEIRO de primeiro atendimento de um robô de WhatsApp. O robô manda as frases que você escrever palavra por palavra, uma pergunta por vez, para quem chegou por um anúncio. Depois um vendedor humano assume.

Negócio: ${n.businessName || '(sem nome)'}
O que vende: ${n.product}
${n.region ? `Região: ${n.region}\n` : ''}
Regras:
- Português do Brasil, tom cordial e direto, como uma pessoa da empresa escreveria no WhatsApp.
- Apresentação curta (1 frase), sem pergunta.
- De 3 a 5 perguntas, curtas, uma ideia por pergunta, que ajudem o vendedor a entender o que a pessoa precisa.
- Uma das perguntas TEM de ser sobre urgência: se pretende contratar/comprar nos próximos dias ou se está só pesquisando.
- NUNCA cite preço, valor, desconto, prazo, cobertura ou garantia. Não prometa nada.
- Encerramento curto (1 frase): agradece e diz que um consultor vai responder por ali.

Cada pergunta pode ter um "campo" (o que a resposta preenche) ou null. Campos permitidos:
${campos}

Responda SÓ com JSON, sem texto em volta:
{"apresentacao": "...", "perguntas": [{"pergunta": "...", "campo": "urgencia"}], "encerramento": "..."}`;
}

function extrairJson(texto: string): string {
  const i = texto.indexOf('{');
  const j = texto.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('resposta sem JSON');
  return texto.slice(i, j + 1);
}

const temPreco = (s: string) => /R\$\s*\d|\d+\s*reais/i.test(s);

/**
 * PURO. Confere o que a IA devolveu. Lança quando não dá para aproveitar —
 * a rota responde erro e o crédito de IA é devolvido (só se cobra o que a IA
 * entregou de fato).
 */
export function validarRoteiroSugerido(bruto: unknown, produto: string): RoteiroSugerido {
  const r = (bruto ?? {}) as { apresentacao?: unknown; perguntas?: unknown; encerramento?: unknown };
  const frase = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

  const intro = frase(r.apresentacao);
  const encerramento = frase(r.encerramento);
  if (!intro || intro.length > LIMITE_FRASE) throw new Error('apresentação inválida');
  if (!encerramento || encerramento.length > LIMITE_FRASE) throw new Error('encerramento inválido');
  if (temPreco(intro) || temPreco(encerramento)) throw new Error('roteiro com preço');

  const permitidos: CampoDoRoteiro[] = ehPlanoDeSaude(produto)
    ? ['tipo', 'vidas', 'idades', 'plano_atual', 'urgencia']
    : ['urgencia'];
  const usados = new Set<CampoDoRoteiro>();
  const passos: PassoDoRoteiro[] = [];
  for (const p of Array.isArray(r.perguntas) ? r.perguntas : []) {
    const item = (p ?? {}) as { pergunta?: unknown; campo?: unknown };
    const pergunta = frase(item.pergunta);
    // Pergunta com preço ou comprida demais é descartada, não corrigida: o
    // texto vai literal ao lead, e reescrever aqui seria a máquina falando.
    if (!pergunta || pergunta.length > LIMITE_PERGUNTA || temPreco(pergunta)) continue;
    const campo = permitidos.includes(item.campo as CampoDoRoteiro) && !usados.has(item.campo as CampoDoRoteiro)
      ? item.campo as CampoDoRoteiro
      : null;
    if (campo) usados.add(campo);
    passos.push({ pergunta, campo });
    if (passos.length === 6) break;
  }
  if (!usados.has('urgencia')) passos.push({ pergunta: PERGUNTA_DE_URGENCIA, campo: 'urgencia' });
  if (passos.length < 2) throw new Error('perguntas insuficientes');
  return { intro, passos, encerramento };
}

/** Pede o rascunho à IA e confere. Lança se a IA falhar ou devolver algo inaproveitável. */
export async function sugerirRoteiro(n: NegocioParaRoteiro): Promise<RoteiroSugerido> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('IA indisponível');
  const resp = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: promptDoRoteiro(n) }],
  });
  const bloco = resp.content.find((b) => b.type === 'text');
  const texto = bloco && bloco.type === 'text' ? bloco.text : '';
  return validarRoteiroSugerido(JSON.parse(extrairJson(texto)), n.product);
}
