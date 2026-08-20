import { describe, it, expect } from 'vitest';
import { enforceCampaignPlanDestination } from '../services/ai.service.js';

// O bug que originou isto: briefing "Plano de saúde samel" fazia a IA devolver
// o site oficial da operadora como destino — o corretor pagava o clique e o
// lead caía no concorrente. O destino do cliente tem que vencer sempre.
const SITE = 'https://segurosamazon.com';

function planWith(destinationUrl: string) {
  return {
    name: 'Campanha',
    adSets: [
      { name: 'Conjunto 1', dailyBudget: 16.67, ads: [{ name: 'Anúncio 1', destinationUrl }] },
      { name: 'Conjunto 2', dailyBudget: 16.67, ads: [{ name: 'Anúncio 2', destinationUrl }] },
    ],
  };
}

describe('enforceCampaignPlanDestination', () => {
  it('sobrescreve a URL que a IA inventou, em todos os anúncios', () => {
    const result = enforceCampaignPlanDestination(planWith('https://www.samel.com.br'), SITE);
    const urls = (result.adSets ?? []).flatMap(
      (as) => (as.ads as Array<{ destinationUrl: string }>).map((ad) => ad.destinationUrl),
    );
    expect(urls).toEqual([SITE, SITE]);
  });

  it('não mexe no plano quando o cliente não informou destino', () => {
    const original = planWith('https://www.samel.com.br');
    expect(enforceCampaignPlanDestination(original, undefined)).toBe(original);
    expect(enforceCampaignPlanDestination(original, '   ')).toBe(original);
  });

  it('preserva os demais campos do anúncio e do conjunto', () => {
    const result = enforceCampaignPlanDestination(planWith('https://errado.com'), SITE);
    expect(result.name).toBe('Campanha');
    expect(result.adSets?.[0].dailyBudget).toBe(16.67);
    expect((result.adSets?.[0].ads as Array<{ name: string }>)[0].name).toBe('Anúncio 1');
  });

  it('aguenta plano sem adSets ou com conjunto sem anúncios', () => {
    expect(enforceCampaignPlanDestination({ name: 'x' }, SITE)).toEqual({ name: 'x' });
    const semAds = { adSets: [{ name: 'Conjunto', dailyBudget: 10 }] };
    expect(enforceCampaignPlanDestination(semAds, SITE)).toEqual(semAds);
  });
});
