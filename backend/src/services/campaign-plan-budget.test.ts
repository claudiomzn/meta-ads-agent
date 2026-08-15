import { describe, expect, it } from 'vitest';

import {
  enforceCampaignPlanBudget,
  MIN_META_MONTHLY_BUDGET_BRL,
} from './ai.service.js';

const plan = {
  name: 'Campanha',
  adSets: [
    { name: 'Conjunto 1', dailyBudget: 5 },
    { name: 'Conjunto 2', dailyBudget: 5 },
  ],
};

describe('enforceCampaignPlanBudget', () => {
  it('usa um conjunto de R$ 10/dia com orçamento mensal de R$ 300', () => {
    const result = enforceCampaignPlanBudget(plan, MIN_META_MONTHLY_BUDGET_BRL);
    expect(result.adSets).toHaveLength(1);
    expect(result.adSets?.[0].dailyBudget).toBe(10);
  });

  it('mantém dois conjuntos de R$ 10/dia com orçamento mensal de R$ 600', () => {
    const result = enforceCampaignPlanBudget(plan, 600);
    expect(result.adSets).toHaveLength(2);
    expect(result.adSets?.map((item) => item.dailyBudget)).toEqual([10, 10]);
  });
});
