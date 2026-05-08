import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PrismaClient } from '@prisma/client';
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
  CreateAudienceParams,
  CampaignPlan,
  PublishResult,
  ValidationResult,
  MCPStatus,
  AdStatus,
} from '../types/meta.types.js';

const prisma = new PrismaClient();

export class PublishValidationError extends Error {
  constructor(
    public errors: string[],
    public warnings: string[] = [],
  ) {
    super(`Validação falhou: ${errors.join(', ')}`);
    this.name = 'PublishValidationError';
  }
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

  // ─── Conexão ──────────────────────────────────────────────────────────────

  async connect(encryptedToken: string, mcpUrl: string): Promise<void> {
    this.accessToken = decrypt(encryptedToken);
    this.mcpUrl = mcpUrl;

    this.client = new Client(
      { name: 'meta-ads-agent', version: '1.0.0' },
      { capabilities: {} },
    );

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: { Authorization: `Bearer ${this.accessToken}` },
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

    return {
      connected: !!conn?.connected,
      provider: conn?.mcpProvider ?? undefined,
      mcpUrl: conn?.mcpUrl ?? undefined,
      adAccountIds: conn ? JSON.parse(conn.adAccountIds) : [],
      lastConnectedAt: conn?.lastConnectedAt ?? undefined,
    };
  }

  // ─── Chamada interna ao MCP com retry (3x backoff exponencial) ───────────

  private async call<T>(tool: string, args: Record<string, unknown>, attempt = 1): Promise<T> {
    if (!this.client || !this.connected) {
      throw new Error('MCP não conectado. Chame connect() primeiro.');
    }

    try {
      const result = await this.client.callTool({ name: tool, arguments: args });

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
    return this.call<{ id: string }>('create_campaign', {
      ad_account_id: params.adAccountId,
      name: params.name,
      objective: params.objective,
      status: params.status,
      special_ad_categories: params.specialAdCategories ?? [],
      ...(params.dailyBudget && { daily_budget: params.dailyBudget * 100 }),
      ...(params.lifetimeBudget && { lifetime_budget: params.lifetimeBudget * 100 }),
    });
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string }> {
    return this.call<{ id: string }>('create_ad_set', {
      campaign_id: params.campaignId,
      name: params.name,
      daily_budget: params.dailyBudget * 100,
      targeting: params.targeting,
      optimization_goal: params.optimizationGoal,
      billing_event: params.billingEvent,
      bid_strategy: params.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP',
      status: params.status,
    });
  }

  async createAd(params: CreateAdParams): Promise<{ id: string }> {
    return this.call<{ id: string }>('create_ad', {
      adset_id: params.adSetId,
      name: params.name,
      creative: {
        title: params.creative.title,
        body: params.creative.body,
        call_to_action: {
          type: params.creative.callToAction.type,
          value: { link: params.creative.callToAction.link },
        },
        ...(params.creative.imageHash && { image_hash: params.creative.imageHash }),
        ...(params.creative.videoId && { video_id: params.creative.videoId }),
        ...(params.creative.imageUrl && { image_url: params.creative.imageUrl }),
      },
      status: params.status,
    });
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

  async updateCampaignBudget(campaignId: string, budget: number): Promise<void> {
    await this.call('update_campaign', {
      campaign_id: campaignId,
      daily_budget: budget * 100,
    });
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
    return this.call<{ hash: string }>('upload_ad_image', {
      ad_account_id: adAccountId,
      url: imageUrl,
    });
  }

  async uploadCreativeVideo(
    videoUrl: string,
    adAccountId: string,
  ): Promise<{ id: string }> {
    return this.call<{ id: string }>('upload_ad_video', {
      ad_account_id: adAccountId,
      url: videoUrl,
    });
  }

  // ─── Publicação completa ──────────────────────────────────────────────────

  async validatePlan(plan: CampaignPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!plan.name?.trim()) errors.push('Nome da campanha é obrigatório');
    if (!plan.objective?.trim()) errors.push('Objetivo da campanha é obrigatório');
    if (!plan.adAccountId?.trim()) errors.push('ID da conta de anúncios é obrigatório');
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

    const campaign = await this.createCampaign({
      adAccountId: plan.adAccountId,
      name: plan.name,
      objective: plan.objective,
      status: 'PAUSED',
      specialAdCategories: plan.specialCategories,
    });

    log(`✅ Campanha criada (ID: ${campaign.id})`);

    await prisma.campaign.updateMany({
      where: { id: plan.localId },
      data: {
        metaCampaignId: campaign.id,
        metaAdAccountId: plan.adAccountId,
        metaStatus: 'PAUSED',
        publishedAt: new Date(),
      },
    });

    const adSetIds: string[] = [];
    const adIds: string[] = [];

    for (const adSetPlan of plan.adSets) {
      log(`Criando conjunto "${adSetPlan.name}"...`);

      const adSet = await this.createAdSet({
        campaignId: campaign.id,
        name: adSetPlan.name,
        dailyBudget: adSetPlan.dailyBudget,
        targeting: adSetPlan.targeting,
        optimizationGoal: adSetPlan.optimizationGoal,
        billingEvent: adSetPlan.billingEvent,
        bidStrategy: adSetPlan.bidStrategy,
        status: 'PAUSED',
      });

      adSetIds.push(adSet.id);
      log(`✅ Conjunto criado (ID: ${adSet.id})`);

      for (const adPlan of adSetPlan.ads) {
        log(`Criando anúncio "${adPlan.name}"...`);

        let imageHash: string | undefined;
        if (adPlan.imageUrl) {
          const uploaded = await this.uploadCreativeImage(adPlan.imageUrl, plan.adAccountId);
          imageHash = uploaded.hash;
        }

        const ad = await this.createAd({
          adSetId: adSet.id,
          name: adPlan.name,
          creative: {
            title: adPlan.headline,
            body: adPlan.bodyText,
            callToAction: { type: adPlan.ctaType, link: adPlan.destinationUrl },
            imageHash,
            imageUrl: !imageHash ? adPlan.imageUrl : undefined,
          },
          status: 'PAUSED',
        });

        adIds.push(ad.id);
        log(`✅ Anúncio criado (ID: ${ad.id})`);
      }
    }

    const managerUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${plan.adAccountId.replace('act_', '')}&selected_campaign_ids=${campaign.id}`;

    log(`🎉 Publicação concluída! ${adSetIds.length} conjuntos, ${adIds.length} anúncios.`);

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
