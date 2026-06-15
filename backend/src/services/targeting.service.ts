// Monta o público-alvo (targeting) de um conjunto de anúncios automaticamente
// a partir do briefing, resolvendo interesses e localização em IDs reais do Meta.
//
// Fluxo:
//   1. IA deriva idade/gênero/localização/interesses (em keywords) do briefing.
//   2. As keywords são resolvidas em IDs válidos via MCP (search_interests /
//      search_geo_locations) — o Meta exige IDs reais, não aceita só nomes.
//   3. Retorna o objeto de targeting pronto para o Meta + um resumo legível.
//
// Tudo com degradação segura: se a resolução falhar, cai para Brasil (país),
// 18-65, ambos os gêneros — garantindo que a publicação nunca quebre por
// targeting inválido.

import { AIService } from './ai.service.js';
import { createMetaMCPService } from './meta.mcp.service.js';

export type AdPlatform = 'ambos' | 'facebook' | 'instagram';

export interface TargetingBriefing {
  product: string;
  audience?: string;
  niche?: string;
  objective?: string;
  businessName?: string;
  regiao?: string;
}

export interface TargetingSummary {
  ageRange: string;
  genders: string;
  location: string;
  interests: string[];
  platforms: string;
  rationale: string;
}

function publisherPlatforms(platform: AdPlatform): string[] {
  if (platform === 'facebook') return ['facebook'];
  if (platform === 'instagram') return ['instagram'];
  return ['facebook', 'instagram'];
}

function gendersLabel(genders: number[]): string {
  const set = new Set(genders);
  if (set.has(1) && set.has(2)) return 'Homens e mulheres';
  if (set.has(1)) return 'Homens';
  if (set.has(2)) return 'Mulheres';
  return 'Homens e mulheres';
}

export async function buildTargeting(
  userId: string,
  briefing: TargetingBriefing,
  platform: AdPlatform = 'ambos',
): Promise<{ targeting: Record<string, unknown>; summary: TargetingSummary }> {
  const ai = new AIService();
  let spec: Awaited<ReturnType<AIService['generateTargeting']>>;
  try {
    spec = await ai.generateTargeting(briefing);
  } catch (err) {
    console.warn('[targeting] Falha ao gerar público com IA, usando padrão (Brasil, 18-65, ambos):', err);
    spec = {
      ageMin: 18,
      ageMax: 65,
      genders: [1, 2],
      location: { query: 'Brasil', type: 'country' },
      interestKeywords: [],
      rationale: 'Não foi possível personalizar o público automaticamente — usando alcance amplo (Brasil, 18-65 anos, todos os gêneros).',
    };
  }

  // Baseline seguro — usado se a resolução via Meta falhar
  let geoLocations: Record<string, unknown> = { countries: ['BR'] };
  let locationLabel = 'Brasil';
  const interests: { id: string; name: string }[] = [];

  let svc: Awaited<ReturnType<typeof createMetaMCPService>> | null = null;
  try {
    svc = await createMetaMCPService(userId);
  } catch (err) {
    console.warn('[targeting] Falha ao conectar ao MCP, usando padrão (Brasil, sem interesses):', err);
  }

  if (svc) {
    try {
      // ── Localização ──────────────────────────────────────────────────────────
      try {
        const locs = await svc.searchGeoLocations(spec.location.query, [spec.location.type]);
        const top = locs[0];
        if (top) {
          if (top.type === 'country' && top.country_code) {
            geoLocations = { countries: [top.country_code] };
            locationLabel = top.name;
          } else if (top.type === 'region') {
            geoLocations = { regions: [{ key: top.key }] };
            locationLabel = `${top.name} (estado)`;
          } else if (top.type === 'city') {
            geoLocations = { cities: [{ key: top.key, radius: 25, distance_unit: 'kilometer' }] };
            locationLabel = `${top.name} + 25km`;
          }
        }
      } catch (err) {
        console.warn('[targeting] Falha ao resolver localização, usando Brasil:', err);
      }

      // ── Interesses ───────────────────────────────────────────────────────────
      for (const keyword of spec.interestKeywords) {
        try {
          const found = await svc.searchInterests(keyword, 1);
          const top = found[0];
          if (top?.id && !interests.some((i) => i.id === top.id)) {
            interests.push({ id: top.id, name: top.name });
          }
        } catch (err) {
          console.warn(`[targeting] Falha ao resolver interesse "${keyword}":`, err);
        }
      }
    } finally {
      await svc.disconnect();
    }
  }

  const bothGenders = spec.genders.includes(1) && spec.genders.includes(2);

  const targeting: Record<string, unknown> = {
    age_min: spec.ageMin,
    age_max: spec.ageMax,
    // Meta interpreta a ausência de "genders" como ambos — só envia quando restringe
    ...(bothGenders ? {} : { genders: spec.genders }),
    geo_locations: geoLocations,
    ...(interests.length ? { flexible_spec: [{ interests }] } : {}),
    publisher_platforms: publisherPlatforms(platform),
  };

  const summary: TargetingSummary = {
    ageRange: `${spec.ageMin}–${spec.ageMax} anos`,
    genders: gendersLabel(spec.genders),
    location: locationLabel,
    interests: interests.map((i) => i.name),
    platforms: platform === 'ambos' ? 'Facebook e Instagram' : platform === 'facebook' ? 'Facebook' : 'Instagram',
    rationale: spec.rationale,
  };

  return { targeting, summary };
}
