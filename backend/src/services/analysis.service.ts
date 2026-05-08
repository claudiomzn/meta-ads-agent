import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tipos de retorno da análise ──────────────────────────────────────────────

export interface CampaignPerformance {
  id: string;
  name: string;
  product: string;
  objective: string;
  budget: number;
  spend: number | null;
  roas: number | null;
  cpc: number | null;
  cpl: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  ctr: number | null;
  status: string;
  createdAt: Date;
  adSets: {
    name: string;
    targeting: string;
    roas: number | null;
    cpl: number | null;
    frequency: number | null;
  }[];
  topAd: {
    headline: string;
    ctr: number | null;
    cpc: number | null;
  } | null;
}

export interface FullAnalysis {
  summary: string;
  totalSpend: number;
  avgRoas: number | null;
  winners: {
    campaignId: string;
    name: string;
    roas: number | null;
    cpl: number | null;
    reasons: string[];
  }[];
  losers: {
    campaignId: string;
    name: string;
    roas: number | null;
    lessons: string[];
  }[];
  patterns: {
    category: string;
    insight: string;
    recommendation: string;
  }[];
  suggestions: {
    name: string;
    rationale: string;
    product: string;
    objective: string;
    budget: number;
    adSets: {
      name: string;
      dailyBudget: number;
      optimizationGoal: string;
      billingEvent: string;
      targeting: object;
      rationale: string;
      ads: {
        name: string;
        headline: string;
        bodyText: string;
        ctaType: string;
        destinationUrl: string;
      }[];
    }[];
  }[];
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export class AnalysisService {
  private systemPrompt = `Você é um especialista sênior em performance marketing e Meta Ads com mais de 10 anos de experiência.
Você analisa dados reais de campanhas, identifica padrões de sucesso e fracasso, e gera estratégias baseadas em evidências.
Retorne sempre JSON válido conforme o schema solicitado. Escreva em português brasileiro.
Seja específico e acionável — evite conselhos genéricos.`;

  // ─── Busca todo o histórico de campanhas do usuário ─────────────────────────

  async fetchCampaignHistory(userId: string): Promise<CampaignPerformance[]> {
    const campaigns = await prisma.campaign.findMany({
      where: { userId },
      include: {
        adSets: {
          include: { ads: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map(c => {
      // CTR calculado localmente
      const ctr =
        c.metaImpressions && c.metaClicks
          ? (c.metaClicks / c.metaImpressions) * 100
          : null;

      // Melhor anúncio por CTR
      const allAds = c.adSets.flatMap(as => as.ads);
      const topAd = allAds.reduce<(typeof allAds)[0] | null>((best, ad) => {
        if (!best) return ad;
        if ((ad.metaCtr ?? 0) > (best.metaCtr ?? 0)) return ad;
        return best;
      }, null);

      return {
        id: c.id,
        name: c.name,
        product: c.product,
        objective: c.objective,
        budget: c.budget,
        spend: c.metaSpend ?? null,
        roas: c.metaRoas ?? null,
        cpc: c.metaCpc ?? null,
        cpl: c.metaCpl ?? null,
        impressions: c.metaImpressions ?? null,
        clicks: c.metaClicks ?? null,
        conversions: c.metaConversions ?? null,
        ctr,
        status: c.status,
        createdAt: c.createdAt,
        adSets: c.adSets.map(as => ({
          name: as.name,
          targeting: as.targeting,
          roas: as.metaRoas ?? null,
          cpl: as.metaCpl ?? null,
          frequency: as.metaFrequency ?? null,
        })),
        topAd: topAd
          ? {
              headline: topAd.headline,
              ctr: topAd.metaCtr ?? null,
              cpc: topAd.metaCpc ?? null,
            }
          : null,
      };
    });
  }

  // ─── Análise completa com Claude ─────────────────────────────────────────────

  async runFullAnalysis(userId: string): Promise<FullAnalysis> {
    const campaigns = await this.fetchCampaignHistory(userId);

    if (campaigns.length === 0) {
      return {
        summary:
          'Nenhuma campanha encontrada. Crie sua primeira campanha para começar a análise.',
        totalSpend: 0,
        avgRoas: null,
        winners: [],
        losers: [],
        patterns: [],
        suggestions: [],
      };
    }

    // Estatísticas gerais para contexto
    const withMetrics = campaigns.filter(c => c.spend !== null && c.spend > 0);
    const totalSpend = withMetrics.reduce((s, c) => s + (c.spend ?? 0), 0);
    const avgRoas =
      withMetrics.length > 0
        ? withMetrics.reduce((s, c) => s + (c.roas ?? 0), 0) / withMetrics.length
        : null;

    const prompt = `Analise o histórico completo de campanhas Meta Ads abaixo e gere um relatório estratégico detalhado.

## DADOS DAS CAMPANHAS

${JSON.stringify(campaigns, null, 2)}

## CONTEXTO
- Total de campanhas: ${campaigns.length}
- Campanhas com dados reais do Meta: ${withMetrics.length}
- Gasto total: R$ ${totalSpend.toFixed(2)}
- ROAS médio: ${avgRoas ? avgRoas.toFixed(2) + 'x' : 'sem dados'}

## INSTRUÇÕES

Retorne APENAS o JSON abaixo, sem markdown, sem texto fora do JSON:

{
  "summary": "parágrafo executivo de 3-4 frases resumindo o estado geral das campanhas e principais descobertas",

  "winners": [
    {
      "campaignId": "id da campanha",
      "name": "nome",
      "roas": 3.5,
      "cpl": 12.50,
      "reasons": ["motivo específico 1", "motivo específico 2"]
    }
  ],

  "losers": [
    {
      "campaignId": "id da campanha",
      "name": "nome",
      "roas": 0.8,
      "lessons": ["lição aprendida específica 1", "o que evitar 1"]
    }
  ],

  "patterns": [
    {
      "category": "Categoria (ex: Público-alvo, Formato, Orçamento, Objetivo, Copy)",
      "insight": "padrão identificado nos dados",
      "recommendation": "ação concreta baseada neste padrão"
    }
  ],

  "suggestions": [
    {
      "name": "Nome da campanha sugerida",
      "rationale": "2-3 frases explicando por que esta campanha deve performar bem baseado no histórico",
      "product": "produto/serviço (baseado nos produtos já anunciados)",
      "objective": "LEAD_GENERATION | CONVERSIONS | TRAFFIC | BRAND_AWARENESS",
      "budget": 1000,
      "adSets": [
        {
          "name": "nome do conjunto",
          "dailyBudget": 50,
          "optimizationGoal": "LEAD_GENERATION",
          "billingEvent": "IMPRESSIONS",
          "targeting": {
            "age_min": 25,
            "age_max": 45,
            "genders": [1, 2],
            "geo_locations": { "countries": ["BR"] },
            "interests": [{ "id": "PLACEHOLDER", "name": "interesse relevante" }]
          },
          "rationale": "por que este público baseado no histórico",
          "ads": [
            {
              "name": "nome do anúncio",
              "headline": "headline otimizada baseada nos melhores performers",
              "bodyText": "copy baseado no que funcionou no histórico",
              "ctaType": "LEARN_MORE",
              "destinationUrl": "https://seusite.com"
            }
          ]
        }
      ]
    }
  ]
}

Gere no mínimo 2 sugestões e no máximo 3. Baseie TODAS as sugestões em evidências do histórico.
Se não houver dados de métricas reais, baseie-se nos objetivos e estrutura das campanhas existentes.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: [
        {
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '{}';

    const analysis = JSON.parse(text) as Omit<
      FullAnalysis,
      'totalSpend' | 'avgRoas'
    >;

    const result: FullAnalysis = {
      ...analysis,
      totalSpend,
      avgRoas,
    };

    // Salva a análise no banco para histórico
    await prisma.campaignInsight.create({
      data: {
        userId,
        type: 'full_analysis',
        title: `Análise de ${campaigns.length} campanhas`,
        summary: result.summary,
        content: JSON.stringify(result),
        campaignsCount: campaigns.length,
      },
    });

    return result;
  }

  // ─── Busca análises anteriores ───────────────────────────────────────────────

  async getInsights(userId: string) {
    return prisma.campaignInsight.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        campaignsCount: true,
        createdAt: true,
      },
    });
  }

  async getInsightById(userId: string, id: string) {
    const insight = await prisma.campaignInsight.findFirst({
      where: { userId, id },
    });
    if (!insight) return null;
    return {
      ...insight,
      content: JSON.parse(insight.content) as FullAnalysis,
    };
  }
}
