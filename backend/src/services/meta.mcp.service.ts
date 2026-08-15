import prisma from '../lib/prisma.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { decrypt } from './crypto.service.js';
import type {
  AdAccount,
  DateRange,
  Insights,
  SpendSummary,
  AccountHealth,
  Campaign,
  AdSet,
  Ad,
  CustomAudience,
  LookalikeAudience,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
  CreateAdCreativeParams,
  CreateAudienceParams,
  CampaignPlan,
  PublishResult,
  ValidationResult,
  MCPStatus,
  AdStatus,
  MetaInterest,
  MetaGeoLocation,
} from '../types/meta.types.js';


// Objetivos em que o Meta aceita targeting_optimization: 'expansion_all' sem
// depender do optimization_goal do conjunto (Lead Generation, Web Conversion).
// TRAFFIC/BRAND_AWARENESS ficam de fora — nem todo optimization_goal deles é
// suportado (ex.: LANDING_PAGE_VIEWS), e enviar o campo lá pode quebrar a publicação.
const TARGETING_EXPANSION_OBJECTIVES = new Set(['LEAD_GENERATION', 'CONVERSIONS']);

export function normalizeCampaignObjective(objective: string): string {
  const objectives: Record<string, string> = {
    LEAD_GENERATION: 'OUTCOME_LEADS',
    CONVERSIONS: 'OUTCOME_SALES',
    TRAFFIC: 'OUTCOME_TRAFFIC',
    AWARENESS: 'OUTCOME_AWARENESS',
    BRAND_AWARENESS: 'OUTCOME_AWARENESS',
    ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
    VIDEO_VIEWS: 'OUTCOME_ENGAGEMENT',
    'Geração de leads': 'OUTCOME_LEADS',
    Vendas: 'OUTCOME_SALES',
    'Tráfego para o site': 'OUTCOME_TRAFFIC',
    'Reconhecimento de marca': 'OUTCOME_AWARENESS',
    'Mensagens no WhatsApp': 'OUTCOME_ENGAGEMENT',
    Engajamento: 'OUTCOME_ENGAGEMENT',
  };
  return objective.startsWith('OUTCOME_') ? objective : (objectives[objective] ?? objective);
}

export function resolveOptimizationGoal(objective: string, suggested?: string): string {
  const normalized = normalizeCampaignObjective(objective);
  const allowed: Record<string, Set<string>> = {
    OUTCOME_TRAFFIC: new Set(['LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'IMPRESSIONS', 'REACH']),
    OUTCOME_AWARENESS: new Set(['REACH', 'IMPRESSIONS', 'AD_RECALL_LIFT']),
    OUTCOME_ENGAGEMENT: new Set(['POST_ENGAGEMENT', 'LINK_CLICKS', 'THRUPLAY']),
    OUTCOME_LEADS: new Set(['LEAD_GENERATION', 'LINK_CLICKS', 'OFFSITE_CONVERSIONS']),
    OUTCOME_SALES: new Set(['OFFSITE_CONVERSIONS', 'VALUE', 'LINK_CLICKS']),
  };
  const fallback: Record<string, string> = {
    OUTCOME_TRAFFIC: 'LINK_CLICKS',
    OUTCOME_AWARENESS: 'REACH',
    OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
    OUTCOME_LEADS: 'LEAD_GENERATION',
    OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
  };
  if (suggested && allowed[normalized]?.has(suggested)) return suggested;
  return fallback[normalized] ?? suggested ?? 'LINK_CLICKS';
}

export class PublishValidationError extends Error {
  constructor(
    public errors: string[],
    public warnings: string[] = [],
  ) {
    super(`Validação falhou: ${errors.join(', ')}`);
    this.name = 'PublishValidationError';
  }
}

export class MetaToolResponseError extends Error {
  constructor(resource: string, detail?: string) {
    super(`A Meta rejeitou ${resource}${detail ? `: ${detail}` : '.'}`);
    this.name = 'MetaToolResponseError';
  }
}

function safeToolErrorDetail(error: unknown): string | undefined {
  let candidate: unknown;
  if (typeof error === 'string') candidate = error;
  else if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    candidate = value.error_user_msg ?? value.message;
    if (!candidate && value.error && typeof value.error === 'object') {
      const nested = value.error as Record<string, unknown>;
      candidate = nested.error_user_msg ?? nested.message;
    }
  }
  if (typeof candidate !== 'string') return undefined;
  const sanitized = candidate
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/EA[A-Za-z0-9_-]{20,}/g, '[credencial]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 240);
  return sanitized || undefined;
}

export class MetaMCPService {
  private client: Client | null = null;
  private connected = false;
  private userId: string;
  private accessToken: string = '';
  private mcpUrl: string = '';

  constructor(userId: string) {
    this.userId = userId;
  }

  private requireId(result: { id?: string; error?: unknown }, resource: string): string {
    if (typeof result.id === 'string' && result.id.trim()) return result.id;
    const detail = safeToolErrorDetail(result.error);
    console.error(`[MCP] Falha ao criar ${resource}`, {
      hasError: result.error !== undefined,
      detail,
    });
    throw new MetaToolResponseError(resource, detail);
  }

  // ─── Conexão ──────────────────────────────────────────────────────────────

  async connect(encryptedToken: string, mcpUrl: string): Promise<void> {
    this.accessToken = decrypt(encryptedToken);
    this.mcpUrl = mcpUrl;

    const pipeboardApiKey = process.env.PIPEBOARD_API_KEY?.trim();
    if (!pipeboardApiKey) {
      throw new Error('Integração Meta temporariamente indisponível.');
    }

    this.client = new Client(
      { name: 'meta-ads-agent', version: '1.0.0' },
      { capabilities: {} },
    );

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: { Authorization: `Bearer ${pipeboardApiKey}` },
      },
    });

    await this.client.connect(transport);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connected = false;
  }

  async getConnectionStatus(): Promise<MCPStatus> {
    const conn = await prisma.mCPConnection.findUnique({
      where: { userId: this.userId },
    });

    let adAccountIds: string[] = [];
    try {
      const parsed: unknown = conn ? JSON.parse(conn.adAccountIds) : [];
      if (Array.isArray(parsed)) {
        adAccountIds = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      adAccountIds = [];
    }

    return {
      connected: !!conn?.connected,
      provider: conn?.mcpProvider ?? undefined,
      adAccountIds,
      lastConnectedAt: conn?.lastConnectedAt ?? undefined,
      connectionHealth: (conn?.connectionHealth as MCPStatus['connectionHealth']) ?? undefined,
      connectionIssue: conn?.connectionIssue ?? undefined,
      lastVerifiedAt: conn?.lastVerifiedAt ?? undefined,
    };
  }

  // ─── Chamada interna ao MCP com retry (3x backoff exponencial) ───────────

  private async call<T>(tool: string, args: Record<string, unknown>, attempt = 1): Promise<T> {
    if (!this.client || !this.connected) {
      throw new Error('MCP não conectado. Chame connect() primeiro.');
    }

    try {
      const result = await this.client.callTool({
        name: tool,
        arguments: { ...args, access_token: this.accessToken },
      });

      if (result.isError) {
        throw new Error(`Erro MCP [${tool}]: ${JSON.stringify(result.content)}`);
      }

      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');

      return JSON.parse(text) as T;
    } catch (err) {
      const isRetryable =
        err instanceof Error &&
        (err.message.includes('timeout') ||
          err.message.includes('rate limit') ||
          err.message.includes('503') ||
          err.message.includes('502'));

      if (isRetryable && attempt < 3) {
        const delay = Math.pow(2, attempt) * 500; // 1s, 2s
        console.warn(`[MCP] Tentativa ${attempt} falhou para "${tool}", retry em ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        return this.call<T>(tool, args, attempt + 1);
      }
      throw err;
    }
  }

  // ─── Leitura — Contas ─────────────────────────────────────────────────────

  async listAdAccounts(): Promise<AdAccount[]> {
    return this.call<AdAccount[]>('get_ad_accounts', {});
  }

  // ─── Leitura — Campanhas ──────────────────────────────────────────────────

  async getCampaigns(adAccountId: string): Promise<Campaign[]> {
    return this.call<Campaign[]>('get_campaigns', { ad_account_id: adAccountId });
  }

  async getCampaignInsights(campaignId: string, dateRange: DateRange): Promise<Insights> {
    return this.call<Insights>('get_campaign_insights', {
      campaign_id: campaignId,
      date_preset: 'custom',
      time_range: { since: dateRange.since, until: dateRange.until },
    });
  }

  // ─── Leitura — Conjuntos ──────────────────────────────────────────────────

  async getAdSets(campaignId: string): Promise<AdSet[]> {
    return this.call<AdSet[]>('get_ad_sets', { campaign_id: campaignId });
  }

  async getAdSetInsights(adSetId: string, dateRange: DateRange): Promise<Insights> {
    return this.call<Insights>('get_ad_set_insights', {
      ad_set_id: adSetId,
      time_range: { since: dateRange.since, until: dateRange.until },
    });
  }

  // ─── Leitura — Anúncios ───────────────────────────────────────────────────

  async getAds(adSetId: string): Promise<Ad[]> {
    return this.call<Ad[]>('get_ads', { ad_set_id: adSetId });
  }

  async getAdInsights(adId: string, dateRange: DateRange): Promise<Insights> {
    return this.call<Insights>('get_ad_insights', {
      ad_id: adId,
      time_range: { since: dateRange.since, until: dateRange.until },
    });
  }

  // ─── Leitura — Públicos ───────────────────────────────────────────────────

  async getCustomAudiences(adAccountId: string): Promise<CustomAudience[]> {
    return this.call<CustomAudience[]>('get_custom_audiences', { ad_account_id: adAccountId });
  }

  async getLookalikeAudiences(adAccountId: string): Promise<LookalikeAudience[]> {
    return this.call<LookalikeAudience[]>('get_lookalike_audiences', {
      ad_account_id: adAccountId,
    });
  }

  // ─── Leitura — Targeting (interesses e localizações reais) ────────────────
  // Resolvem nomes/keywords em IDs válidos do catálogo do Meta — necessário
  // para montar o público automaticamente (interesses precisam de ID real,
  // não basta o nome).

  async searchInterests(query: string, limit = 25): Promise<MetaInterest[]> {
    const res = await this.call<{ data?: MetaInterest[] }>('search_interests', { query, limit });
    return res.data ?? [];
  }

  async searchGeoLocations(
    query: string,
    locationTypes?: string[],
    limit = 25,
  ): Promise<MetaGeoLocation[]> {
    const res = await this.call<{ data?: MetaGeoLocation[] }>('search_geo_locations', {
      query,
      ...(locationTypes?.length ? { location_types: locationTypes } : {}),
      limit,
    });
    return res.data ?? [];
  }

  // ─── Leitura — Conta ──────────────────────────────────────────────────────

  async getAccountHealth(adAccountId: string): Promise<AccountHealth> {
    return this.call<AccountHealth>('get_account_health', { ad_account_id: adAccountId });
  }

  async getSpendSummary(adAccountId: string, dateRange: DateRange): Promise<SpendSummary> {
    return this.call<SpendSummary>('get_spend_summary', {
      ad_account_id: adAccountId,
      time_range: { since: dateRange.since, until: dateRange.until },
    });
  }

  // ─── Escrita — Criação ────────────────────────────────────────────────────

  async createCampaign(params: CreateCampaignParams): Promise<{ id: string }> {
    const result = await this.call<{ id?: string; error?: unknown }>('create_campaign', {
      account_id: params.adAccountId,
      name: params.name,
      objective: normalizeCampaignObjective(params.objective),
      status: params.status,
      special_ad_categories: params.specialAdCategories ?? [],
      // O AdsGenius define o orçamento em cada conjunto. Sem esta opção, o
      // Pipeboard cria por padrão um orçamento também na campanha (CBO) e a
      // Meta pode rejeitar o orçamento duplicado do conjunto.
      use_adset_level_budgets: true,
      ...(params.dailyBudget && { daily_budget: params.dailyBudget * 100 }),
      ...(params.lifetimeBudget && { lifetime_budget: params.lifetimeBudget * 100 }),
    });
    return { id: this.requireId(result, 'campanha') };
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string }> {
    const result = await this.call<{ id?: string; error?: unknown }>('create_adset', {
      account_id: params.accountId,
      campaign_id: params.campaignId,
      name: params.name,
      daily_budget: params.dailyBudget * 100,
      targeting: params.targeting,
      optimization_goal: params.optimizationGoal,
      billing_event: params.billingEvent,
      bid_strategy: params.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP',
      status: params.status,
    });
    return { id: this.requireId(result, 'conjunto de anúncios') };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string }> {
    const result = await this.call<{ id?: string; error?: unknown }>('create_ad', {
      account_id: params.accountId,
      adset_id: params.adSetId,
      name: params.name,
      creative_id: params.creativeId,
      status: params.status,
    });
    return { id: this.requireId(result, 'anúncio') };
  }

  async createAdCreative(params: CreateAdCreativeParams): Promise<{ id: string }> {
    const result = await this.call<{ creative_id?: string; id?: string; error?: unknown }>(
      'create_ad_creative',
      {
        account_id: params.accountId,
        name: params.name,
        page_id: params.pageId,
        link_url: params.linkUrl,
        message: params.message,
        headline: params.headline,
        call_to_action_type: params.callToActionType,
        ...(params.imageHash && { image_hash: params.imageHash }),
        ...(params.videoId && { video_id: params.videoId }),
      },
    );
    return { id: this.requireId({ id: result.creative_id ?? result.id, error: result.error }, 'criativo') };
  }

  async createCustomAudience(params: CreateAudienceParams): Promise<{ id: string }> {
    return this.call<{ id: string }>('create_custom_audience', {
      ad_account_id: params.adAccountId,
      name: params.name,
      subtype: params.subtype,
      description: params.description,
      rule: params.rule,
    });
  }

  // ─── Escrita — Edição ─────────────────────────────────────────────────────

  async updateCampaignStatus(campaignId: string, status: AdStatus): Promise<void> {
    await this.call('update_campaign', { campaign_id: campaignId, status });
  }

  async updateCampaignBudget(campaignId: string, budget: number): Promise<void> {
    await this.call('update_campaign', {
      campaign_id: campaignId,
      daily_budget: budget * 100,
    });
  }

  // Escala o orçamento diário da campanha por um fator (1.2 = +20%), partindo
  // do orçamento ATUAL salvo no banco — nunca do valor de uma métrica. Usado
  // pelas automações SCALE_UP/SCALE_DOWN. Retorna o novo orçamento, ou null se
  // a campanha não for encontrada / não tiver orçamento conhecido.
  async scaleCampaignBudget(metaCampaignId: string, factor: number): Promise<number | null> {
    const campaign = await prisma.campaign.findFirst({
      where: { metaCampaignId },
      select: { id: true, budget: true },
    });
    if (!campaign || !campaign.budget || campaign.budget <= 0) {
      console.warn(`[scaleBudget] Campanha ${metaCampaignId} sem orçamento conhecido — pulando scale`);
      return null;
    }
    const newBudget = Math.round(campaign.budget * factor * 100) / 100;
    await this.updateCampaignBudget(metaCampaignId, newBudget);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { budget: newBudget } });
    return newBudget;
  }

  async updateAdSetStatus(adSetId: string, status: AdStatus): Promise<void> {
    await this.call('update_ad_set', { ad_set_id: adSetId, status });
  }

  async updateAdStatus(adId: string, status: AdStatus): Promise<void> {
    await this.call('update_ad', { ad_id: adId, status });
  }

  async duplicateAdSet(adSetId: string, newBudget?: number): Promise<{ id: string }> {
    return this.call<{ id: string }>('duplicate_ad_set', {
      ad_set_id: adSetId,
      ...(newBudget && { daily_budget: newBudget * 100 }),
    });
  }

  // ─── Escrita — Upload de criativos ────────────────────────────────────────

  async uploadCreativeImage(
    imageUrl: string,
    adAccountId: string,
  ): Promise<{ hash: string }> {
    const result = await this.call<{ hash?: string; error?: unknown }>('upload_ad_image', {
      account_id: adAccountId,
      image_url: imageUrl,
    });
    if (typeof result.hash !== 'string' || !result.hash.trim()) {
      console.error('[MCP] Falha no upload da imagem', { hasError: result.error !== undefined });
      throw new Error('Não foi possível enviar a imagem para a Meta.');
    }
    return { hash: result.hash };
  }

  async uploadCreativeVideo(
    videoUrl: string,
    adAccountId: string,
  ): Promise<{ id: string }> {
    const result = await this.call<{ id?: string; video_id?: string; error?: unknown }>('upload_ad_video', {
      account_id: adAccountId,
      video_url: videoUrl,
    });
    return { id: this.requireId({ id: result.video_id ?? result.id, error: result.error }, 'vídeo') };
  }

  // ─── Publicação completa ──────────────────────────────────────────────────

  async validatePlan(plan: CampaignPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!plan.name?.trim()) errors.push('Nome da campanha é obrigatório');
    if (!plan.objective?.trim()) errors.push('Objetivo da campanha é obrigatório');
    if (!plan.adAccountId?.trim()) errors.push('ID da conta de anúncios é obrigatório');
    if (!plan.pageId?.trim()) errors.push('Página do Facebook é obrigatória');
    if (!plan.adSets?.length) errors.push('A campanha precisa ter pelo menos um conjunto de anúncios');

    for (const adSet of plan.adSets ?? []) {
      if (!adSet.name?.trim()) errors.push(`Conjunto sem nome encontrado`);
      if (!adSet.dailyBudget || adSet.dailyBudget < 1) {
        errors.push(`Conjunto "${adSet.name}": orçamento diário mínimo é R$ 1,00`);
      }
      if (!adSet.ads?.length) {
        errors.push(`Conjunto "${adSet.name}" não tem anúncios`);
      }

      for (const ad of adSet.ads ?? []) {
        if (!ad.headline?.trim()) errors.push(`Anúncio "${ad.name}": headline é obrigatório`);
        if (!ad.bodyText?.trim()) errors.push(`Anúncio "${ad.name}": texto é obrigatório`);
        if (!ad.destinationUrl?.trim()) errors.push(`Anúncio "${ad.name}": URL de destino é obrigatória`);
        if (!ad.imageHash && !ad.imageUrl && !ad.videoId && !ad.videoUrl) {
          errors.push(`Anúncio "${ad.name}": imagem ou vídeo é obrigatório`);
        }
        if (ad.headline && ad.headline.length > 255) {
          warnings.push(`Anúncio "${ad.name}": headline com mais de 255 caracteres pode ser truncado`);
        }
        if (ad.bodyText && ad.bodyText.length > 2000) {
          warnings.push(`Anúncio "${ad.name}": texto muito longo pode ser rejeitado pelo Meta`);
        }
      }
    }

    if (plan.adSets?.some((s) => s.dailyBudget < 5)) {
      warnings.push('Orçamentos muito baixos (< R$ 5/dia) podem prejudicar a entrega');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async publishCampaignPlan(
    plan: CampaignPlan,
    onProgress?: (msg: string) => void,
  ): Promise<PublishResult> {
    const log = (msg: string) => {
      console.log(`[MCP Publish] ${msg}`);
      onProgress?.(msg);
    };

    const validation = await this.validatePlan(plan);
    if (!validation.valid) {
      throw new PublishValidationError(validation.errors, validation.warnings);
    }

    log(`Iniciando publicação: "${plan.name}"`);

    const normalizedObjective = normalizeCampaignObjective(plan.objective);
    const campaign = await this.createCampaign({
      adAccountId: plan.adAccountId,
      name: plan.name,
      objective: plan.objective,
      status: 'PAUSED',
      specialAdCategories: plan.specialCategories,
    });

    log(`✅ Campanha criada (ID: ${campaign.id})`);

    const adSetIds: string[] = [];
    const adIds: string[] = [];

    for (const adSetPlan of plan.adSets) {
      log(`Criando conjunto "${adSetPlan.name}"...`);

      // Detailed Targeting Expansion: deixa o Meta ir além dos interesses
      // definidos quando encontra pessoas com maior chance de conversão, sem
      // alterar geo/idade/gênero/exclusões. Só suportado para os objetivos
      // abaixo — em outros o Meta rejeita a publicação com erro.
      const targeting = TARGETING_EXPANSION_OBJECTIVES.has(plan.objective)
        ? { ...adSetPlan.targeting, targeting_optimization: 'expansion_all' }
        : adSetPlan.targeting;

      const adSet = await this.createAdSet({
        accountId: plan.adAccountId,
        campaignId: campaign.id,
        name: adSetPlan.name,
        dailyBudget: adSetPlan.dailyBudget,
        targeting,
        optimizationGoal: resolveOptimizationGoal(normalizedObjective, adSetPlan.optimizationGoal),
        billingEvent: adSetPlan.billingEvent,
        bidStrategy: adSetPlan.bidStrategy,
        status: 'PAUSED',
      });

      adSetIds.push(adSet.id);
      log(`✅ Conjunto criado (ID: ${adSet.id})`);

      // Persiste o metaAdSetId no AdSet local — sem isso, sync/automações/
      // métricas que dependem desse campo perdem o vínculo com o Meta.
      if (adSetPlan.localId) {
        await prisma.adSet.updateMany({
          where: { id: adSetPlan.localId },
          data: { metaAdSetId: adSet.id, metaStatus: 'PAUSED' },
        });
      }

      for (const adPlan of adSetPlan.ads) {
        log(`Criando anúncio "${adPlan.name}"...`);

        let imageHash = adPlan.imageHash;
        if (!imageHash && adPlan.imageUrl) {
          const uploaded = await this.uploadCreativeImage(adPlan.imageUrl, plan.adAccountId);
          imageHash = uploaded.hash;
        }

        let videoId = adPlan.videoId;
        if (!videoId && adPlan.videoUrl) {
          const uploaded = await this.uploadCreativeVideo(adPlan.videoUrl, plan.adAccountId);
          videoId = uploaded.id;
        }

        const creative = await this.createAdCreative({
          accountId: plan.adAccountId,
          name: `${adPlan.name} — Criativo`,
          pageId: plan.pageId,
          linkUrl: adPlan.destinationUrl,
          message: adPlan.bodyText,
          headline: adPlan.headline,
          callToActionType: adPlan.ctaType,
          imageHash,
          videoId,
        });

        log(`✅ Criativo criado (ID: ${creative.id})`);

        const ad = await this.createAd({
          accountId: plan.adAccountId,
          adSetId: adSet.id,
          name: adPlan.name,
          creativeId: creative.id,
          status: 'PAUSED',
        });

        adIds.push(ad.id);
        log(`✅ Anúncio criado (ID: ${ad.id})`);

        // Persiste o metaAdId no Ad local — mesmo motivo do metaAdSetId acima.
        if (adPlan.localId) {
          await prisma.ad.updateMany({
            where: { id: adPlan.localId },
            data: { metaAdId: ad.id, metaCreativeId: creative.id, metaStatus: 'PAUSED' },
          });
        }
      }
    }

    const managerUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${plan.adAccountId.replace('act_', '')}&selected_campaign_ids=${campaign.id}`;

    log(`🎉 Publicação concluída! ${adSetIds.length} conjuntos, ${adIds.length} anúncios.`);

    await prisma.campaign.updateMany({
      where: { id: plan.localId },
      data: {
        metaCampaignId: campaign.id,
        metaAdAccountId: plan.adAccountId,
        metaStatus: 'PAUSED',
        publishedAt: new Date(),
      },
    });

    return {
      success: true,
      campaignId: campaign.id,
      status: 'PAUSED_FOR_REVIEW',
      adSetIds,
      adIds,
      managerUrl,
    };
  }
}

// Factory — carrega conexão salva no banco para o usuário
export async function createMetaMCPService(userId: string): Promise<MetaMCPService> {
  const service = new MetaMCPService(userId);

  const conn = await prisma.mCPConnection.findUnique({ where: { userId } });
  if (conn?.connected && conn.metaAccessToken && conn.mcpUrl) {
    await service.connect(conn.metaAccessToken, conn.mcpUrl);
  }

  return service;
}
