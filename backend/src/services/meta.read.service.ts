// MetaReadService — fachada de LEITURA com failover automático.
//
// Tenta o Pipeboard (MetaMCPService) primeiro e, se ele falhar ou não conectar,
// cai para a Graph API direta (MetaGraphService). Remove o ponto único de falha
// do Pipeboard nas leituras (dashboards, insights, sync).
//
// Comportamento controlado pela env META_GRAPH_FALLBACK:
//   - "true"  → failover ativo (tenta MCP, cai para Graph em caso de falha)
//   - ausente → comportamento atual inalterado (somente MCP)
//
// As ESCRITAS continuam exclusivamente no MetaMCPService — esta fachada cobre só
// leitura, conforme o escopo aprovado.

import prisma from '../lib/prisma.js';
import { MetaMCPService } from './meta.mcp.service.js';
import { MetaGraphService } from './meta.graph.service.js';
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
  MetaGeoLocation,
  MetaInterest,
  SpendSummary,
} from '../types/meta.types.js';

const FALLBACK_ENABLED = process.env.META_GRAPH_FALLBACK === 'true';

export class MetaReadService {
  private userId: string;
  private mcp: MetaMCPService;
  private graph: MetaGraphService;
  private mcpConnected = false;

  constructor(userId: string) {
    this.userId = userId;
    this.mcp = new MetaMCPService(userId);
    this.graph = new MetaGraphService(userId);
  }

  async init(): Promise<void> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (conn?.connected && conn.metaAccessToken && conn.mcpUrl) {
      try {
        await this.mcp.connect(conn.metaAccessToken, conn.mcpUrl);
        this.mcpConnected = true;
      } catch (err) {
        console.warn('[meta-read] Pipeboard não conectou, usando Graph como fallback:', String(err));
        this.mcpConnected = false;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.mcpConnected) await this.mcp.disconnect();
  }

  // Executa via MCP (primário) com fallback para Graph.
  private async exec<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    // Failover desligado → comportamento atual (somente MCP).
    if (!FALLBACK_ENABLED) return primary();

    // MCP não conectou → vai direto para a Graph.
    if (!this.mcpConnected) return fallback();

    try {
      return await primary();
    } catch (err) {
      console.warn(`[meta-read] MCP falhou em "${label}", caindo para Graph API:`, String(err));
      return fallback();
    }
  }

  listAdAccounts(): Promise<AdAccount[]> {
    return this.exec('listAdAccounts', () => this.mcp.listAdAccounts(), () => this.graph.listAdAccounts());
  }

  getCampaigns(adAccountId: string): Promise<Campaign[]> {
    return this.exec('getCampaigns', () => this.mcp.getCampaigns(adAccountId), () => this.graph.getCampaigns(adAccountId));
  }

  getCampaignInsights(campaignId: string, dateRange: DateRange): Promise<Insights> {
    return this.exec('getCampaignInsights', () => this.mcp.getCampaignInsights(campaignId, dateRange), () => this.graph.getCampaignInsights(campaignId, dateRange));
  }

  getAdSets(campaignId: string): Promise<AdSet[]> {
    return this.exec('getAdSets', () => this.mcp.getAdSets(campaignId), () => this.graph.getAdSets(campaignId));
  }

  getAdSetInsights(adSetId: string, dateRange: DateRange): Promise<Insights> {
    return this.exec('getAdSetInsights', () => this.mcp.getAdSetInsights(adSetId, dateRange), () => this.graph.getAdSetInsights(adSetId, dateRange));
  }

  getAds(adSetId: string): Promise<Ad[]> {
    return this.exec('getAds', () => this.mcp.getAds(adSetId), () => this.graph.getAds(adSetId));
  }

  getAdInsights(adId: string, dateRange: DateRange): Promise<Insights> {
    return this.exec('getAdInsights', () => this.mcp.getAdInsights(adId, dateRange), () => this.graph.getAdInsights(adId, dateRange));
  }

  getCustomAudiences(adAccountId: string): Promise<CustomAudience[]> {
    return this.exec('getCustomAudiences', () => this.mcp.getCustomAudiences(adAccountId), () => this.graph.getCustomAudiences(adAccountId));
  }

  getLookalikeAudiences(adAccountId: string): Promise<LookalikeAudience[]> {
    return this.exec('getLookalikeAudiences', () => this.mcp.getLookalikeAudiences(adAccountId), () => this.graph.getLookalikeAudiences(adAccountId));
  }

  searchInterests(query: string, limit = 25): Promise<MetaInterest[]> {
    return this.exec('searchInterests', () => this.mcp.searchInterests(query, limit), () => this.graph.searchInterests(query, limit));
  }

  searchGeoLocations(query: string, locationTypes?: string[], limit = 25): Promise<MetaGeoLocation[]> {
    return this.exec('searchGeoLocations', () => this.mcp.searchGeoLocations(query, locationTypes, limit), () => this.graph.searchGeoLocations(query, locationTypes, limit));
  }

  getAccountHealth(adAccountId: string): Promise<AccountHealth> {
    return this.exec('getAccountHealth', () => this.mcp.getAccountHealth(adAccountId), () => this.graph.getAccountHealth(adAccountId));
  }

  getSpendSummary(adAccountId: string, dateRange: DateRange): Promise<SpendSummary> {
    return this.exec('getSpendSummary', () => this.mcp.getSpendSummary(adAccountId, dateRange), () => this.graph.getSpendSummary(adAccountId, dateRange));
  }
}

// Factory: cria e inicializa (conecta MCP, com tolerância a falha) a fachada.
export async function createMetaReadService(userId: string): Promise<MetaReadService> {
  const service = new MetaReadService(userId);
  await service.init();
  return service;
}
