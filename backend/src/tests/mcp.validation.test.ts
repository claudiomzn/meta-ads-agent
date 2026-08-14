import { describe, it, expect, vi } from 'vitest';
import { MetaMCPService } from '../services/meta.mcp.service.js';
import type { CampaignPlan } from '../types/meta.types.js';

function makePlan(overrides: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    localId: 'local-1',
    adAccountId: 'act_123456789',
    pageId: '456789123',
    name: 'Campanha Teste',
    objective: 'LEAD_GENERATION',
    adSets: [
      {
        name: 'Conjunto 1',
        dailyBudget: 50,
        targeting: { age_min: 25, age_max: 45 },
        optimizationGoal: 'LEAD_GENERATION',
        billingEvent: 'IMPRESSIONS',
        ads: [
          {
            name: 'Anúncio 1',
            headline: 'Título do anúncio',
            bodyText: 'Texto do anúncio para teste',
            ctaType: 'LEARN_MORE',
            destinationUrl: 'https://seusite.com',
            imageUrl: 'https://cdn.example.com/anuncio.jpg',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('MetaMCPService.validatePlan', () => {
  const svc = new MetaMCPService('user-test');

  it('valida plano correto sem erros', async () => {
    const result = await svc.validatePlan(makePlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita plano sem nome', async () => {
    const result = await svc.validatePlan(makePlan({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Nome da campanha é obrigatório');
  });

  it('rejeita plano sem adAccountId', async () => {
    const result = await svc.validatePlan(makePlan({ adAccountId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ID da conta de anúncios é obrigatório');
  });

  it('rejeita plano sem Página do Facebook', async () => {
    const result = await svc.validatePlan(makePlan({ pageId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Página do Facebook é obrigatória');
  });

  it('rejeita plano sem adSets', async () => {
    const result = await svc.validatePlan(makePlan({ adSets: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('A campanha precisa ter pelo menos um conjunto de anúncios');
  });

  it('rejeita conjunto com orçamento zero', async () => {
    const plan = makePlan();
    plan.adSets[0].dailyBudget = 0;
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('orçamento diário mínimo'))).toBe(true);
  });

  it('rejeita anúncio sem headline', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].headline = '';
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('headline'))).toBe(true);
  });

  it('rejeita anúncio sem URL de destino', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].destinationUrl = '';
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('URL de destino'))).toBe(true);
  });

  it('rejeita anúncio sem imagem nem vídeo', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].imageUrl = undefined;
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('imagem ou vídeo'))).toBe(true);
  });

  it('gera warning para conjunto com orçamento < R$5', async () => {
    const plan = makePlan();
    plan.adSets[0].dailyBudget = 3;
    const result = await svc.validatePlan(plan);
    expect(result.warnings.some((w) => w.includes('R$ 5'))).toBe(true);
  });

  it('gera warning para headline muito longa', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].headline = 'A'.repeat(260);
    const result = await svc.validatePlan(plan);
    expect(result.warnings.some((w) => w.includes('255 caracteres'))).toBe(true);
  });

  it('acumula múltiplos erros', async () => {
    const plan = makePlan({ name: '', adAccountId: '' });
    plan.adSets[0].ads[0].headline = '';
    plan.adSets[0].ads[0].destinationUrl = '';
    const result = await svc.validatePlan(plan);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('MetaMCPService — contrato de publicação Pipeboard', () => {
  function mockCall(svc: MetaMCPService, response: object) {
    return vi.spyOn(
      svc as unknown as { call: (tool: string, args: Record<string, unknown>) => Promise<object> },
      'call',
    ).mockResolvedValue(response);
  }

  it('usa create_adset com account_id', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'adset-1' });
    await svc.createAdSet({
      accountId: 'act_123', campaignId: 'campaign-1', name: 'Conjunto', dailyBudget: 20,
      targeting: {}, optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', status: 'PAUSED',
    });
    expect(call).toHaveBeenCalledWith('create_adset', expect.objectContaining({ account_id: 'act_123' }));
  });

  it('cria o criativo separado com Página e mídia', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { creative_id: 'creative-1' });
    await svc.createAdCreative({
      accountId: 'act_123', name: 'Criativo', pageId: 'page-1', linkUrl: 'https://adsgenius.net',
      message: 'Texto', headline: 'Título', callToActionType: 'LEARN_MORE', imageHash: 'hash-1',
    });
    expect(call).toHaveBeenCalledWith('create_ad_creative', expect.objectContaining({
      account_id: 'act_123', page_id: 'page-1', image_hash: 'hash-1',
    }));
  });

  it('cria o anúncio referenciando o creative_id', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'ad-1' });
    await svc.createAd({
      accountId: 'act_123', adSetId: 'adset-1', name: 'Anúncio', creativeId: 'creative-1', status: 'PAUSED',
    });
    expect(call).toHaveBeenCalledWith('create_ad', {
      account_id: 'act_123', adset_id: 'adset-1', name: 'Anúncio', creative_id: 'creative-1', status: 'PAUSED',
    });
  });

  it('normaliza o objetivo legado para o objetivo atual da Meta', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'campaign-1' });
    await svc.createCampaign({ adAccountId: 'act_123', name: 'Campanha', objective: 'TRAFFIC', status: 'PAUSED' });
    expect(call).toHaveBeenCalledWith('create_campaign', expect.objectContaining({
      objective: 'OUTCOME_TRAFFIC', use_adset_level_budgets: true,
    }));
  });
});
