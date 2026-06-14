import prisma from '../lib/prisma.js';
import axios from 'axios';

import Anthropic from '@anthropic-ai/sdk';
import { decrypt } from './crypto.service.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export interface IGPost {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  permalink: string;
  insights?: {
    reach?: number;
    impressions?: number;
    engagement?: number;
    saved?: number;
  };
}

export interface IGAccount {
  id: string;
  name: string;
  username: string;
  followers_count: number;
  media_count: number;
  profile_picture_url?: string;
  biography?: string;
}

export interface IGAnalysis {
  summary: string;
  bestPosts: { id: string; reason: string }[];
  worstPosts: { id: string; reason: string }[];
  patterns: { title: string; insight: string; recommendation: string }[];
  bestTime: string;
  bestType: string;
  suggestions: string[];
}

export class InstagramService {
  private userId: string;
  private token = '';

  constructor(userId: string) {
    this.userId = userId;
  }

  // ─── Token ────────────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.token) return this.token;

    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn) throw new Error('Conta Meta não conectada. Faça o onboarding primeiro.');

    // Pipeboard/Zapier não têm token Meta direto — usa o META_ACCESS_TOKEN do .env
    if (conn.mcpProvider === 'pipeboard' || conn.mcpProvider === 'zapier') {
      const envToken = process.env.META_ACCESS_TOKEN;
      if (!envToken) {
        throw new Error(
          'Para analisar o Instagram, adicione META_ACCESS_TOKEN no .env com permissões: instagram_basic, instagram_manage_insights, pages_show_list.',
        );
      }
      this.token = envToken;
    } else {
      this.token = decrypt(conn.metaAccessToken);
    }

    return this.token;
  }

  // ─── Conta IG ─────────────────────────────────────────────────────────────

  async getAccount(): Promise<IGAccount> {
    const token = await this.getToken();

    // Se META_INSTAGRAM_ACCOUNT_ID está configurado, usa diretamente (Page Token)
    const envIgId = process.env.META_INSTAGRAM_ACCOUNT_ID;
    if (envIgId) {
      const igRes = await axios.get(`${GRAPH}/${envIgId}`, {
        params: {
          access_token: token,
          fields: 'id,name,username,followers_count,media_count,profile_picture_url,biography',
        },
      });
      return igRes.data as IGAccount;
    }

    // Fallback: busca páginas do Facebook vinculadas (requer User Token)
    const pagesRes = await axios.get(`${GRAPH}/me/accounts`, {
      params: { access_token: token, fields: 'id,name,instagram_business_account' },
    });

    const page = (pagesRes.data.data ?? []).find(
      (p: Record<string, unknown>) => p.instagram_business_account,
    );

    if (!page) {
      throw new Error(
        'Nenhuma conta Instagram Business encontrada. Vincule sua conta Instagram a uma Página do Facebook no Gerenciador de Negócios.',
      );
    }

    const igId = (page.instagram_business_account as { id: string }).id;

    const igRes = await axios.get(`${GRAPH}/${igId}`, {
      params: {
        access_token: token,
        fields: 'id,name,username,followers_count,media_count,profile_picture_url,biography',
      },
    });

    return igRes.data as IGAccount;
  }

  // ─── Posts ────────────────────────────────────────────────────────────────

  async getPosts(igAccountId: string, limit = 30): Promise<IGPost[]> {
    const token = await this.getToken();

    const res = await axios.get(`${GRAPH}/${igAccountId}/media`, {
      params: {
        access_token: token,
        fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
        limit,
      },
    });

    const posts: IGPost[] = res.data.data ?? [];

    // Busca insights para cada post (em paralelo, até 10 de uma vez)
    const chunks = [];
    for (let i = 0; i < posts.length; i += 10) chunks.push(posts.slice(i, i + 10));

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (post) => {
          post.insights = await this.getPostInsights(post.id).catch(() => ({}));
        }),
      );
    }

    return posts;
  }

  // ─── Insights por post ────────────────────────────────────────────────────

  async getPostInsights(mediaId: string): Promise<IGPost['insights']> {
    const token = await this.getToken();

    try {
      const res = await axios.get(`${GRAPH}/${mediaId}/insights`, {
        params: { access_token: token, metric: 'reach,impressions,engagement,saved' },
      });

      const result: Record<string, number> = {};
      (res.data.data ?? []).forEach((m: { name: string; values?: { value: number }[]; value?: number }) => {
        result[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
      });
      return result;
    } catch {
      return {};
    }
  }

  // ─── Insights da conta ────────────────────────────────────────────────────

  async getAccountInsights(igAccountId: string): Promise<unknown[]> {
    const token = await this.getToken();

    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);

    try {
      const res = await axios.get(`${GRAPH}/${igAccountId}/insights`, {
        params: {
          access_token: token,
          metric: 'impressions,reach,profile_views',
          period: 'day',
          since,
          until,
        },
      });
      return res.data.data ?? [];
    } catch {
      return [];
    }
  }

  // ─── Análise IA ───────────────────────────────────────────────────────────

  async analyzeWithAI(posts: IGPost[], account: IGAccount): Promise<IGAnalysis> {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const postsForPrompt = posts.slice(0, 25).map((p) => ({
      id: p.id,
      tipo: p.media_type,
      data: p.timestamp,
      curtidas: p.like_count,
      comentarios: p.comments_count,
      alcance: p.insights?.reach ?? 0,
      impressoes: p.insights?.impressions ?? 0,
      engajamento: p.insights?.engagement ?? 0,
      salvos: p.insights?.saved ?? 0,
      legenda: p.caption?.substring(0, 200),
      link: p.permalink,
    }));

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: `Você é um especialista em marketing digital e Instagram com foco em resultados.
Analise os dados dos posts e retorne APENAS JSON válido, sem texto antes ou depois.`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Conta: @${account.username} | ${account.followers_count} seguidores | ${account.media_count} posts

Posts recentes (últimos ${posts.length}):
${JSON.stringify(postsForPrompt, null, 2)}

Retorne este JSON exato:
{
  "summary": "resumo em 2-3 frases sobre a performance geral",
  "bestPosts": [{"id": "id_do_post", "reason": "por que funcionou"}],
  "worstPosts": [{"id": "id_do_post", "reason": "por que não funcionou"}],
  "patterns": [
    {"title": "nome do padrão", "insight": "o que os dados mostram", "recommendation": "o que fazer"}
  ],
  "bestTime": "ex: Terças e quintas entre 18h-20h",
  "bestType": "ex: Reels curtos de 15-30s têm 3x mais alcance",
  "suggestions": ["sugestão concreta 1", "sugestão concreta 2", "sugestão concreta 3", "sugestão concreta 4", "sugestão concreta 5"]
}`,
        },
      ],
    });

    const text = response.content.find((c) => c.type === 'text')?.text ?? '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match?.[0] ?? '{}') as IGAnalysis;
  }
}
