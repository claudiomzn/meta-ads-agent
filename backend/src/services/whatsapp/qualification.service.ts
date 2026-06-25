// Motor de qualificação de leads via IA (agnóstico de transporte).
// Recebe a config do cliente + histórico da conversa e devolve a próxima
// mensagem do bot, o novo estado e (quando encerra) o rótulo + resumo.

import Anthropic from '@anthropic-ai/sdk';

// Modelo barato e rápido — qualificação é tarefa simples. ~R$0,07/conversa.
const MODEL = 'claude-haiku-4-5';

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export interface QualConfig {
  businessName: string;
  product: string;
  differentials?: string | null;
  region?: string | null;
  tone: string;
  questions: string[];
  qualifiedCriteria: string;
  maxQuestions: number;
  maxBotMessages: number;
  businessHours?: string | null;
}

export interface QualTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface QualResult {
  /** Texto que o bot deve enviar ao lead. */
  reply: string;
  /** Próximo estado da conversa. */
  state: 'greeting' | 'qualifying' | 'qualified' | 'cold' | 'handoff' | 'closed';
  /** Conversa encerrada (passar para humano ou finalizada). */
  done: boolean;
  /** Rótulo final, quando done. */
  label?: 'QUENTE' | 'FRIO';
  /** Resumo de 1 linha para o vendedor, quando qualificado. */
  summary?: string;
}

function buildSystemPrompt(cfg: QualConfig): string {
  const qs = cfg.questions.length
    ? cfg.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : '(use seu julgamento para qualificar)';
  return `Você é o assistente de atendimento da ${cfg.businessName}, que oferece ${cfg.product}${cfg.region ? ` em ${cfg.region}` : ''}.${cfg.differentials ? ` Diferenciais: ${cfg.differentials}.` : ''}

Seu objetivo: qualificar o lead que chegou por um anúncio, com NO MÁXIMO ${cfg.maxQuestions} perguntas curtas, e passar para um consultor humano quando estiver qualificado.

REGRAS (siga à risca):
- UMA pergunta por mensagem. Nunca faça várias perguntas de uma vez.
- Tom: ${cfg.tone}. No máximo 1 emoji por mensagem. Mensagens curtas (estilo WhatsApp).
- NÃO invente preços, prazos ou condições. Se perguntarem valores, diga que o consultor passa os números exatos.
- Critério de lead QUALIFICADO: ${cfg.qualifiedCriteria}.
- Encerre e passe para o consultor quando: o lead estiver qualificado, OU pedir falar com uma pessoa, OU estiver claramente sem intenção real.
${cfg.businessHours ? `- Horário de atendimento: ${cfg.businessHours}. Fora dele, avise que o consultor responde no próximo expediente.` : ''}

Perguntas de qualificação sugeridas:
${qs}

FORMATO DE RESPOSTA — responda SEMPRE em JSON válido, sem markdown:
{
  "reply": "a mensagem que você enviaria ao lead agora",
  "done": false,
  "label": null,
  "summary": null
}
Quando encerrar (done=true): "label" deve ser "QUENTE" (qualificado) ou "FRIO" (sem intenção), e "summary" um resumo de 1 linha para o vendedor com os dados coletados.`;
}

function extractJson(text: string): string {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) return block[1].trim();
  const s = text.indexOf('{');
  if (s === -1) return text.trim();
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return text.trim();
}

/**
 * Gera a próxima resposta do bot. `history` inclui a mensagem recém-recebida
 * do lead como último item (role:'user').
 */
export async function nextReply(
  cfg: QualConfig,
  history: QualTurn[],
  questionsAsked: number,
  botMessages: number,
): Promise<QualResult> {
  // Trava dura: se passou do limite de mensagens, força handoff sem chamar a IA.
  if (botMessages >= cfg.maxBotMessages) {
    return {
      reply: 'Vou te passar para um de nossos consultores para continuar o atendimento. 👍',
      state: 'handoff',
      done: true,
      label: 'QUENTE',
      summary: 'Lead atingiu o limite de mensagens do bot — encaminhado ao consultor.',
    };
  }

  const messages: Anthropic.MessageParam[] = history.map((h) => ({
    role: h.role,
    content: h.text,
  }));

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [
      { type: 'text', text: buildSystemPrompt(cfg), cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });

  const raw = resp.content.find((b) => b.type === 'text');
  const text = raw && raw.type === 'text' ? raw.text : '';

  let parsed: { reply?: string; done?: boolean; label?: string; summary?: string };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    // Se a IA não devolveu JSON, usa o texto cru como resposta e segue qualificando.
    parsed = { reply: text || 'Pode me contar um pouco mais?', done: false };
  }

  const done = Boolean(parsed.done);
  const label = parsed.label === 'QUENTE' || parsed.label === 'FRIO' ? parsed.label : undefined;
  const state: QualResult['state'] = done
    ? (label === 'FRIO' ? 'cold' : 'handoff')
    : questionsAsked === 0 ? 'greeting' : 'qualifying';

  return {
    reply: parsed.reply || 'Obrigado! Um consultor vai continuar com você.',
    state,
    done,
    label,
    summary: parsed.summary || undefined,
  };
}
