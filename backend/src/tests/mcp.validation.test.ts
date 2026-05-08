import { describe, it, expect } from 'vitest';
import { MetaMCPService } from '../services/meta.mcp.service.js';
import type { CampaignPlan } from '../types/meta.types.js';

function makePlan(overrides: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    localId: 'local-1',
    adAccountId: 'act_123456789',
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
