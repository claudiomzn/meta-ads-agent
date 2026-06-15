// MetaGraphService — fallback de LEITURA direto na Graph API do Meta.
//
// Implementa os mesmos métodos de leitura do MetaMCPService, porém chamando
// graph.facebook.com diretamente (sem Pipeboard), usando o System User token
// (META_ACCESS_TOKEN) — mesmo padrão já usado em pixel.service.ts.
//
// Objetivo: remover o ponto único de falha do Pipeboard nas leituras. Quando o
// Pipeboard estiver fora do ar, a fachada de failover (meta.read.service.ts)
// cai automaticamente para este serviço.
//
// ⚠️ Os mapeamentos de campos/unidades seguem a doc da Graph API, mas precisam
// de validação contra uma conta real antes de habilitar o failover em produção
// (flag META_GRAPH_FALLBACK). Ver self-test em mcp.routes.ts.

import axios from 'axios';
import prisma from '../lib/prisma.js';
import { decrypt } from './crypto.service.js';
import type {
  AdAccount,
  AdSet,
  Ad,
  AccountHealth,
  Campaign,
  CustomAudience,
  DateRange,
  Insights,
  LookalikeAudience,
  MCPStatus,
  MetaGeoLocation,
  MetaInterest,
  SpendSummary,
} from '../types/meta.types.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

// Tipos de ação do Meta que contam como conversão/lead para nossas métricas.
const CONVERSION_ACTION_TYPES = [
  'lead',
  'purchase',
  'complete_registration',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_purchase',
  'offsite_conversion.fb_pixel_complete_registration',
  'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d',
];

interface GraphAction {
  action_type: string;
  value: string;
}

interface GraphInsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  date_start?: string;
  date_stop?: string;
  actions?: GraphAction[];
  action_values?: GraphAction[];
  purchase_roas?: GraphAction[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Converte orçamento da Graph (string em centavos) para a unidade da moeda.
function budgetFromMinor(v: unknown): number {
  return num(v) / 100;
}

function sumActions(actions: GraphAction[] | undefined, types: string[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((acc, a) => acc + num(a.value), 0);
}

function mapInsights(row: GraphInsightRow | undefined, dateRange: DateRange): Insights {
  if (!row) {
    return {
      spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpl: 0, roas: 0,
      conversions: 0, reach: 0, frequency: 0,
      dateStart: dateRange.since, dateStop: dateRange.until,
    };
  }
  const spend = num(row.spend);
  const conversions = sumActions(row.actions, CONVERSION_ACTION_TYPES);
  const roas = row.purchase_roas?.length ? num(row.purchase_roas[0].value) : 0;
  return {
    spend,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
    cpc: num(row.cpc),
    cpl: conversions > 0 ? spend / conversions : 0,
    roas,
    conversions,
    reach: num(row.reach),
    frequency: num(row.frequency),
    dateStart: row.date_start ?? dateRange.since,
    dateStop: row.date_stop ?? dateRange.until,
  };
}

export class MetaGraphService {
  private userId: string;
  private token: string | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  // Resolve o token do System User (mesma lógica do pixel.service).
  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn) throw new Error('Conta Meta não conectada.');

    if (conn.mcpProvider === 'pipeboard' || conn.mcpProvider === 'zapier') {
      const envToken = process.env.META_ACCESS_TOKEN;
      if (!envToken) throw new Error('META_ACCESS_TOKEN não configurado.');
      this.token = envToken;
    } else {
      this.token = decrypt(conn.metaAccessToken);
    }
    return this.token;
  }

  private async graphGet<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const token = await this.getToken();
    const res = await axios.get(`${GRAPH}/${path}`, {
      params: { access_token: token, ...params },
      timeout: 20000,
    });
    return res.data as T;
  }

  private timeRange(dateRange: DateRange): string {
    return JSON.stringify({ since: dateRange.since, until: dateRange.until });
  }

  // ─── Conexão / status ──────────────────────────────────────────────────────

  async getConnectionStatus(): Promise<MCPStatus> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    return {
      connected: !!conn?.connected,
      provider: conn?.mcpProvider ?? undefined,
      mcpUrl: conn?.mcpUrl ?? undefined,
      adAccountIds: conn ? JSON.parse(conn.adAccountIds) : [],
      lastConnectedAt: conn?.lastConnectedAt ?? undefined,
    };
  }

  // ─── Leitura — Contas ────────────────────────────────────────────────────────

  async listAdAccounts(): Promise<AdAccount[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>('me/adaccounts', {
      fields: 'id,name,currency,timezone_name,account_status',
      limit: 100,
    });
    return (data.data ?? []).map((a) => ({
      id: String(a.id),
      name: String(a.name ?? ''),
      currency: String(a.currency ?? ''),
      timezone: String(a.timezone_name ?? ''),
      status: num(a.account_status),
    }));
  }

  // ─── Leitura — Campanhas ──────────────────────────────────────────────────────

  async getCampaigns(adAccountId: string): Promise<Campaign[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(`${adAccountId}/campaigns`, {
      fields: 'id,name,objective,status,daily_budget,lifetime_budget,created_time',
      limit: 200,
    });
    return (data.data ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      objective: String(c.objective ?? ''),
      status: String(c.status ?? ''),
      dailyBudget: c.daily_budget != null ? budgetFromMinor(c.daily_budget) : undefined,
      lifetimeBudget: c.lifetime_budget != null ? budgetFromMinor(c.lifetime_budget) : undefined,
      createdTime: String(c.created_time ?? ''),
    }));
  }

  async getCampaignInsights(campaignId: string, dateRange: DateRange): Promise<Insights> {
    const data = await this.graphGet<{ data?: GraphInsightRow[] }>(`${campaignId}/insights`, {
      fields: 'spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values,purchase_roas',
      time_range: this.timeRange(dateRange),
    });
    return mapInsights(data.data?.[0], dateRange);
  }

  // ─── Leitura — Conjuntos ──────────────────────────────────────────────────────

  async getAdSets(campaignId: string): Promise<AdSet[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(`${campaignId}/adsets`, {
      fields: 'id,name,campaign_id,status,daily_budget,optimization_goal,billing_event,targeting',
      limit: 200,
    });
    return (data.data ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name ?? ''),
      campaignId: String(s.campaign_id ?? campaignId),
      status: String(s.status ?? ''),
      dailyBudget: budgetFromMinor(s.daily_budget),
      optimizationGoal: String(s.optimization_goal ?? ''),
      billingEvent: String(s.billing_event ?? ''),
      targeting: (s.targeting as Record<string, unknown>) ?? {},
    }));
  }

  async getAdSetInsights(adSetId: string, dateRange: DateRange): Promise<Insights> {
    const data = await this.graphGet<{ data?: GraphInsightRow[] }>(`${adSetId}/insights`, {
      fields: 'spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values,purchase_roas',
      time_range: this.timeRange(dateRange),
    });
    return mapInsights(data.data?.[0], dateRange);
  }

  // ─── Leitura — Anúncios ───────────────────────────────────────────────────────

  async getAds(adSetId: string): Promise<Ad[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(`${adSetId}/ads`, {
      fields: 'id,name,adset_id,status,creative{title,body,image_url,object_story_spec}',
      limit: 200,
    });
    return (data.data ?? []).map((ad) => {
      const creative = ad.creative as Record<string, unknown> | undefined;
      return {
        id: String(ad.id),
        name: String(ad.name ?? ''),
        adSetId: String(ad.adset_id ?? adSetId),
        status: String(ad.status ?? ''),
        creative: creative
          ? {
              title: String(creative.title ?? ''),
              body: String(creative.body ?? ''),
              imageUrl: creative.image_url ? String(creative.image_url) : undefined,
            }
          : undefined,
      };
    });
  }

  async getAdInsights(adId: string, dateRange: DateRange): Promise<Insights> {
    const data = await this.graphGet<{ data?: GraphInsightRow[] }>(`${adId}/insights`, {
      fields: 'spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values,purchase_roas',
      time_range: this.timeRange(dateRange),
    });
    return mapInsights(data.data?.[0], dateRange);
  }

  // ─── Leitura — Públicos ───────────────────────────────────────────────────────

  async getCustomAudiences(adAccountId: string): Promise<CustomAudience[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(`${adAccountId}/customaudiences`, {
      fields: 'id,name,approximate_count_lower_bound,subtype',
      limit: 200,
    });
    return (data.data ?? []).map((a) => ({
      id: String(a.id),
      name: String(a.name ?? ''),
      approximateCount: num(a.approximate_count_lower_bound),
      subtype: String(a.subtype ?? ''),
    }));
  }

  async getLookalikeAudiences(adAccountId: string): Promise<LookalikeAudience[]> {
    const data = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(`${adAccountId}/customaudiences`, {
      fields: 'id,name,approximate_count_lower_bound,subtype,lookalike_spec',
      limit: 200,
    });
    return (data.data ?? [])
      .filter((a) => String(a.subtype) === 'LOOKALIKE')
      .map((a) => {
        const spec = a.lookalike_spec as { ratio?: number; origin?: Array<{ id?: string }> } | undefined;
        return {
          id: String(a.id),
          name: String(a.name ?? ''),
          approximateCount: num(a.approximate_count_lower_bound),
          originAudienceId: spec?.origin?.[0]?.id ? String(spec.origin[0].id) : '',
          ratio: num(spec?.ratio),
        };
      });
  }

  // ─── Leitura — Targeting (interesses e localizações) ──────────────────────────

  async searchInterests(query: string, limit = 25): Promise<MetaInterest[]> {
    const data = await this.graphGet<{ data?: MetaInterest[] }>('search', {
      type: 'adinterest',
      q: query,
      limit,
    });
    return data.data ?? [];
  }

  async searchGeoLocations(
    query: string,
    locationTypes?: string[],
    limit = 25,
  ): Promise<MetaGeoLocation[]> {
    const data = await this.graphGet<{ data?: MetaGeoLocation[] }>('search', {
      type: 'adgeolocation',
      q: query,
      limit,
      ...(locationTypes?.length ? { location_types: JSON.stringify(locationTypes) } : {}),
    });
    return data.data ?? [];
  }

  // ─── Leitura — Conta ──────────────────────────────────────────────────────────

  async getAccountHealth(adAccountId: string): Promise<AccountHealth> {
    const a = await this.graphGet<Record<string, unknown>>(adAccountId, {
      fields: 'account_status,disable_reason,amount_spent,balance,spend_cap',
    });
    const statusMap: Record<number, AccountHealth['status']> = {
      1: 'ACTIVE',
      2: 'DISABLED',
      3: 'UNSETTLED',
      7: 'PENDING_RISK_REVIEW',
    };
    return {
      status: statusMap[num(a.account_status)] ?? 'DISABLED',
      disableReason: a.disable_reason != null ? String(a.disable_reason) : undefined,
      amountSpent: budgetFromMinor(a.amount_spent),
      balance: budgetFromMinor(a.balance),
      spendCap: budgetFromMinor(a.spend_cap),
    };
  }

  async getSpendSummary(adAccountId: string, _dateRange: DateRange): Promise<SpendSummary> {
    const presets = ['today', 'this_week_mon_today', 'this_month', 'maximum'] as const;
    const [today, thisWeek, thisMonth, lifetime] = await Promise.all(
      presets.map(async (preset) => {
        const data = await this.graphGet<{ data?: GraphInsightRow[] }>(`${adAccountId}/insights`, {
          fields: 'spend',
          date_preset: preset,
        });
        return num(data.data?.[0]?.spend);
      }),
    );
    return { today, thisWeek, thisMonth, lifetime };
  }
}
