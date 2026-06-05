import prisma from '../lib/prisma.js';
import Anthropic from '@anthropic-ai/sdk';



// Lazy client — criado só quando usado, após dotenv ter carregado
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Remove marcadores de markdown (```json ... ```) e extrai JSON puro
function extractJson(text: string): string {
  // 1. Tenta extrair de bloco de código markdown
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();

  // 2. Encontra o início do JSON ({) e usa parse incremental para pegar só o JSON válido
  const start = text.indexOf('{');
  const startArr = text.indexOf('[');
  const s = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (s === -1) return text.trim();

  // Percorre para encontrar o fechamento correto balanceando chaves/colchetes
  let depth = 0;
  let inString = false;
  let escape = false;
  const openChar = text[s];
  const closeChar = openChar === '{' ? '}' : ']';

  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return text.slice(s, i + 1);
    }
  }

  return text.trim();
}

interface GenerateCopyParams {
  product: string;
  audience?: string;
  framework: 'AIDA' | 'PAS' | 'BAB' | string;
  format: string;
  tone?: string;
}

interface GeneratedCopy {
  headline: string;
  body: string;
  cta: string;
}

interface GenerateCampaignParams {
  product: string;
  objective: string;
  budget: number;
  audience?: string;
  differentials?: string;
  ticketMedio?: number;
  regiao?: string;
  concorrentes?: string;
  niche?: string;
  businessName?: string;
}

// Contexto específico por nicho — alimenta a IA com dores reais, público típico e CTAs que convertem
const NICHE_CONTEXT: Record<string, { dores: string; publico: string; ganchos: string; ctas: string }> = {
  clinica: {
    dores: 'dor crônica, dificuldade de agendamento, medo de procedimentos, falta de tempo para cuidar da saúde',
    publico: 'adultos 28-60 anos, homens e mulheres, preocupados com saúde e bem-estar',
    ganchos: 'atendimento humanizado, resultados comprovados, equipe especializada, sem fila de espera',
    ctas: 'Agendar consulta, Falar com especialista, Quero agendar',
  },
  loja: {
    dores: 'preço alto, frete caro, medo de comprar errado, demora na entrega',
    publico: 'compradores online 18-50 anos, interessados na categoria do produto',
    ganchos: 'desconto exclusivo, frete grátis, parcelamento sem juros, troca fácil',
    ctas: 'Comprar agora, Ver oferta, Aproveitar desconto',
  },
  escola: {
    dores: 'filho com dificuldade escolar, método tradicional não funciona, falta de atenção, notas baixas',
    publico: 'pais e responsáveis 28-50 anos com filhos em idade escolar',
    ganchos: 'metodologia exclusiva, resultado comprovado, aula experimental grátis, turmas reduzidas',
    ctas: 'Agendar aula grátis, Conhecer a escola, Quero uma vaga',
  },
  academia: {
    dores: 'falta de motivação, resultado lento, dificuldade de emagrecer, sem tempo, academia cara',
    publico: 'adultos 18-45 anos interessados em fitness, emagrecimento e qualidade de vida',
    ganchos: 'primeira semana grátis, treino personalizado, resultados visíveis em 30 dias, sem fidelidade',
    ctas: 'Começar agora, Primeira semana grátis, Quero emagrecer',
  },
  restaurante: {
    dores: 'cansaço de cozinhar, falta de opções saborosas, delivery demorado, comida sem qualidade',
    publico: 'moradores e trabalhadores num raio de 8km, que pedem delivery ou saem para almoçar/jantar',
    ganchos: 'ingredientes frescos, entrega rápida, chef experiente, promoção especial',
    ctas: 'Pedir agora, Ver cardápio, Fazer reserva',
  },
  imoveis: {
    dores: 'aluguel caro, dificuldade de financiamento, medo de dar entrada, burocracia',
    publico: 'adultos 28-55 anos com renda compatível, interessados em comprar ou alugar imóvel na região',
    ganchos: 'financiamento facilitado, entrada parcelada, localização privilegiada, documentação simplificada',
    ctas: 'Quero saber mais, Falar com consultor, Agendar visita',
  },
  servicos: {
    dores: 'problema urgente sem solução, medo de contratar errado, preço abusivo, falta de garantia',
    publico: 'moradores da região que precisam do serviço, todas as idades',
    ganchos: 'atendimento rápido, orçamento grátis, garantia no serviço, profissional certificado',
    ctas: 'Chamar no WhatsApp, Pedir orçamento grátis, Atendimento agora',
  },
  infoproduto: {
    dores: 'falta de conhecimento, carreira estagnada, renda baixa, não sabe por onde começar',
    publico: 'adultos 20-45 anos querendo aprender, mudar de carreira ou aumentar renda',
    ganchos: 'método comprovado, suporte direto, certificado reconhecido, resultado garantido',
    ctas: 'Quero aprender, Garantir minha vaga, Começar hoje',
  },
  outro: {
    dores: 'problema que o produto resolve, falta de praticidade, custo alto, falta de confiança',
    publico: 'público-alvo específico do produto ou serviço',
    ganchos: 'diferencial principal, resultado esperado, facilidade de uso, suporte',
    ctas: 'Saiba mais, Falar conosco, Quero conhecer',
  },
};

export class AIService {
  // Prompt cacheável — instruções do sistema são estáticas
  private systemPrompt = `Você é um especialista em copywriting para Meta Ads (Facebook e Instagram) com mais de 10 anos de experiência.
Você domina os frameworks AIDA, PAS e BAB, escreve em português brasileiro, e cria copies que convertem.
Retorne sempre JSON válido conforme o schema solicitado.`;

  async generateCopy(params: GenerateCopyParams): Promise<GeneratedCopy> {
    const { product, audience, framework, format, tone } = params;

    const frameworkGuides: Record<string, string> = {
      AIDA: 'Atenção → Interesse → Desejo → Ação',
      PAS: 'Problema → Agitação → Solução',
      BAB: 'Before (situação atual) → After (situação desejada) → Bridge (seu produto como ponte)',
    };

    const userPrompt = `Crie um copy para Meta Ads usando o framework ${framework} (${frameworkGuides[framework] ?? framework}).

Produto/Serviço: ${product}
${audience ? `Público-alvo: ${audience}` : ''}
Formato do anúncio: ${format}
${tone ? `Tom de voz: ${tone}` : 'Tom de voz: persuasivo e direto'}

Retorne APENAS o JSON abaixo, sem markdown:
{
  "headline": "título principal (máx 255 chars)",
  "body": "texto do anúncio (máx 2000 chars)",
  "cta": "texto do botão de ação (máx 30 chars)"
}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(extractJson(text)) as GeneratedCopy;
  }

  async generateCampaignPlan(params: GenerateCampaignParams): Promise<object> {
    const { product, objective, budget, audience, differentials, ticketMedio, regiao, concorrentes, niche, businessName } = params;

    // Contexto específico do nicho — enriquece muito a qualidade dos copies gerados
    const nicheCtx = niche ? NICHE_CONTEXT[niche] ?? NICHE_CONTEXT.outro : null;

    const userPrompt = `Crie um plano de campanha para Meta Ads. Seja CONCISO e ESPECÍFICO.

Negócio: ${businessName || product}
Setor: ${product}
Objetivo: ${objective}
Orçamento mensal: R$ ${budget}
${audience ? `Público-alvo: ${audience}` : ''}
${differentials ? `Diferenciais: ${differentials}` : ''}
${ticketMedio ? `Ticket médio: R$ ${ticketMedio}` : ''}
${regiao ? `Região-alvo: ${regiao}` : ''}
${concorrentes ? `Concorrentes: ${concorrentes}` : ''}
${nicheCtx ? `
--- Contexto do setor (use para personalizar) ---
Dores típicas do cliente: ${nicheCtx.dores}
Público típico: ${nicheCtx.publico}
Ganchos que convertem: ${nicheCtx.ganchos}
CTAs recomendados: ${nicheCtx.ctas}` : ''}

Retorne APENAS este JSON (sem markdown, sem texto extra). Use NO MÁXIMO 2 conjuntos de anúncio e 1 anúncio por conjunto:
{
  "name": "nome da campanha",
  "strategy": "estratégia em 1-2 frases",
  "adSets": [
    {
      "name": "nome do conjunto",
      "dailyBudget": 50,
      "optimizationGoal": "LEAD_GENERATION",
      "billingEvent": "IMPRESSIONS",
      "targeting": {
        "age_min": 25,
        "age_max": 55,
        "genders": [1, 2],
        "geo_locations": { "countries": ["BR"] },
        "interests": [{ "id": "PLACEHOLDER", "name": "interesse relevante" }]
      },
      "rationale": "por que este público (1 frase)",
      "ads": [
        {
          "name": "nome do anúncio",
          "headline": "título (máx 80 chars)",
          "bodyText": "texto (máx 300 chars)",
          "ctaType": "LEARN_MORE",
          "destinationUrl": "https://seusite.com"
        }
      ]
    }
  ]
}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(extractJson(text));
  }

  // ── Score de copy ─────────────────────────────────────────────────────────
  async scoreCopy(params: {
    headline: string;
    body: string;
    cta: string;
    objective?: string;
    product?: string;
  }): Promise<{ score: number; strengths: string[]; issues: string[]; suggestion: string }> {
    const { headline, cta, objective, product } = params;
    // Trunca body longo para evitar respostas gigantes
    const body = params.body.length > 600 ? params.body.slice(0, 600) + '...' : params.body;

    const userPrompt = `Avalie esta copy para Meta Ads. Responda SOMENTE com JSON, nada mais.
${product ? `Produto: ${product}` : ''}${objective ? ` | Objetivo: ${objective}` : ''}
Headline: ${headline}
Body: ${body}
CTA: ${cta}
Critérios (0-2 pts cada): clareza, dor/desejo, gatilhos mentais, coerência, objetividade.
JSON (máx 2 itens por array, cada item máx 120 chars):
{"score":0.0,"strengths":["s1","s2"],"issues":["i1","i2"],"suggestion":"s"}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

    // Tenta parse direto primeiro
    try {
      const parsed = JSON.parse(extractJson(text));
      return {
        score: Number(parsed.score ?? 0),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
      };
    } catch {
      // Fallback: extrai score via regex se JSON vier corrompido
      const scoreMatch = text.match(/"score"\s*:\s*([\d.]+)/);
      const score = scoreMatch ? Number(scoreMatch[1]) : 0;
      console.warn('[scoreCopy] JSON parse falhou, usando extração parcial. score=', score);
      return { score, strengths: [], issues: ['Análise parcial — tente novamente para detalhes.'], suggestion: '' };
    }
  }

  // ── Melhoria de copy baseada na análise ───────────────────────────────────
  async improveCopy(params: {
    headline: string;
    body: string;
    cta: string;
    objective?: string;
    product?: string;
    issues: string[];
    suggestion: string;
  }): Promise<{ headline: string; body: string; cta: string }> {
    const { headline, cta, objective, product, issues, suggestion } = params;
    const body = params.body.length > 600 ? params.body.slice(0, 600) + '...' : params.body;

    const userPrompt = `Você é um especialista em copywriting para Meta Ads. Reescreva a copy abaixo corrigindo os problemas apontados.
${product ? `Produto: ${product}` : ''}${objective ? ` | Objetivo: ${objective}` : ''}

COPY ORIGINAL:
Headline: ${headline}
Body: ${body}
CTA: ${cta}

PROBLEMAS A CORRIGIR:
${issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}

SUGESTÃO DA ANÁLISE:
${suggestion}

Regras:
- Mantenha o mesmo produto/serviço e objetivo
- Corrija todos os problemas listados
- Use gatilhos mentais: urgência, prova social, especificidade
- Headline máx 10 palavras, Body máx 4 frases, CTA máx 5 palavras
- Responda SOMENTE com JSON válido, sem markdown:
{"headline":"...","body":"...","cta":"..."}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    try {
      const parsed = JSON.parse(extractJson(text));
      return {
        headline: parsed.headline ?? headline,
        body: parsed.body ?? body,
        cta: parsed.cta ?? cta,
      };
    } catch {
      return { headline, body, cta };
    }
  }

  async generateAlerts(campaigns: Array<{ name: string; metrics: object }>): Promise<string[]> {
    if (!campaigns.length) return [];

    const userPrompt = `Analise as métricas das campanhas abaixo e gere alertas acionáveis.

Campanhas:
${JSON.stringify(campaigns, null, 2)}

Retorne APENAS um array JSON de strings com os alertas mais importantes (máximo 5):
["alerta 1", "alerta 2", ...]

Foque em: frequência alta (> 3.5), ROAS baixo, CTR baixo após 2000 impressões, oportunidades de escala.`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    return JSON.parse(extractJson(text)) as string[];
  }

  async generateCreativeBrief(params: {
    product: string;
    audience: string;
    objective: string;
  }): Promise<object> {
    const userPrompt = `Crie um briefing criativo completo para anúncio de Meta Ads.

Produto: ${params.product}
Público: ${params.audience}
Objetivo: ${params.objective}

Retorne APENAS o JSON:
{
  "concept": "conceito criativo em 2-3 frases",
  "midjourneyPrompt": "prompt detalhado para Midjourney em inglês",
  "palette": "3-4 cores hex separadas por vírgula",
  "dimensions": "1080x1080 (feed) | 1080x1920 (stories)",
  "elements": "elementos visuais essenciais separados por vírgula"
}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(extractJson(text));
  }
}
