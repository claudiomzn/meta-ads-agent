import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
}

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

    const response = await client.messages.create({
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
    return JSON.parse(text) as GeneratedCopy;
  }

  async generateCampaignPlan(params: GenerateCampaignParams): Promise<object> {
    const { product, objective, budget, audience, differentials } = params;

    const userPrompt = `Crie um plano completo de campanha para Meta Ads.

Produto: ${product}
Objetivo: ${objective}
Orçamento total: R$ ${budget}
${audience ? `Público-alvo: ${audience}` : ''}
${differentials ? `Diferenciais: ${differentials}` : ''}

Retorne APENAS o JSON com esta estrutura:
{
  "name": "nome da campanha",
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
      "rationale": "por que este público",
      "ads": [
        {
          "name": "nome do anúncio",
          "headline": "título",
          "bodyText": "texto",
          "ctaType": "LEARN_MORE",
          "destinationUrl": "https://seusite.com"
        }
      ]
    }
  ],
  "strategy": "descrição da estratégia geral"
}`;

    const response = await client.messages.create({
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
    return JSON.parse(text);
  }

  async generateAlerts(campaigns: Array<{ name: string; metrics: object }>): Promise<string[]> {
    if (!campaigns.length) return [];

    const userPrompt = `Analise as métricas das campanhas abaixo e gere alertas acionáveis.

Campanhas:
${JSON.stringify(campaigns, null, 2)}

Retorne APENAS um array JSON de strings com os alertas mais importantes (máximo 5):
["alerta 1", "alerta 2", ...]

Foque em: frequência alta (> 3.5), ROAS baixo, CTR baixo após 2000 impressões, oportunidades de escala.`;

    const response = await client.messages.create({
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
    return JSON.parse(text) as string[];
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

    const response = await client.messages.create({
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
    return JSON.parse(text);
  }
}
