import { describe, it, expect, vi } from 'vitest';
import { MetaMCPService } from '../services/meta.mcp.service.js';

// A IA monta a segmentação junto com o plano e inventa a chave da cidade.
// "PLACEHOLDER_MANAUS" chegou à Meta e derrubou a publicação inteira com
// "o tipo integer é esperado, mas um tipo string foi recebido".
function svcWithGeo(found: Array<{ key: string; name: string; type: string }>) {
  const svc = new MetaMCPService('user-test');
  const spy = vi.spyOn(svc, 'searchGeoLocations').mockResolvedValue(found as never);
  return { svc, spy };
}

const logs: string[] = [];
const log = (m: string) => { logs.push(m); };

describe('resolveTargetingGeo', () => {
  it('troca a chave inventada pelo ID real da cidade', async () => {
    logs.length = 0;
    const { svc, spy } = svcWithGeo([{ key: '1234567', name: 'Manaus', type: 'city' }]);

    const out = await svc.resolveTargetingGeo({
      age_min: 20,
      geo_locations: { cities: [{ key: 'PLACEHOLDER_MANAUS', radius: 25, distance_unit: 'kilometer' }] },
    }, log);

    expect(spy).toHaveBeenCalledWith('MANAUS', ['city']);
    expect(out.geo_locations).toEqual({
      cities: [{ key: '1234567', radius: 25, distance_unit: 'kilometer' }],
    });
    expect(out.age_min).toBe(20); // não mexe no resto
  });

  it('prefere o nome quando ele vem junto, em vez do prefixo da chave', async () => {
    logs.length = 0;
    const { svc, spy } = svcWithGeo([{ key: '999', name: 'Belém', type: 'city' }]);

    await svc.resolveTargetingGeo({
      geo_locations: { cities: [{ key: 'XPTO', name: 'Belém' }] },
    }, log);

    expect(spy).toHaveBeenCalledWith('Belém', ['city']);
  });

  it('não toca em chave que já é numérica', async () => {
    logs.length = 0;
    const { svc, spy } = svcWithGeo([]);
    const geo = { cities: [{ key: '1234567', radius: 25 }] };

    const out = await svc.resolveTargetingGeo({ geo_locations: geo }, log);

    expect(spy).not.toHaveBeenCalled();
    expect(out.geo_locations).toEqual(geo);
  });

  it('avisa e cai para o Brasil quando nada resolve — nunca em silêncio', async () => {
    logs.length = 0;
    const { svc } = svcWithGeo([]); // Meta não achou nada

    const out = await svc.resolveTargetingGeo({
      geo_locations: { cities: [{ key: 'PLACEHOLDER_ATLANTIDA' }] },
    }, log);

    expect(out.geo_locations).toEqual({ countries: ['BR'] });
    expect(logs.some((l) => l.includes('ATLANTIDA'))).toBe(true);
    expect(logs.some((l) => l.includes('Brasil inteiro'))).toBe(true);
  });

  it('preserva o país já definido quando a cidade não resolve', async () => {
    logs.length = 0;
    const { svc } = svcWithGeo([]);

    const out = await svc.resolveTargetingGeo({
      geo_locations: { countries: ['BR'], cities: [{ key: 'PLACEHOLDER_X' }] },
    }, log);

    expect(out.geo_locations).toEqual({ countries: ['BR'] });
    expect(logs.some((l) => l.includes('Brasil inteiro'))).toBe(false);
  });

  it('falha de rede na busca não derruba a publicação, só ignora a localização', async () => {
    logs.length = 0;
    const svc = new MetaMCPService('user-test');
    vi.spyOn(svc, 'searchGeoLocations').mockRejectedValue(new Error('rede'));

    const out = await svc.resolveTargetingGeo({
      geo_locations: { countries: ['BR'], regions: [{ key: 'PLACEHOLDER_AMAZONAS' }] },
    }, log);

    expect(out.geo_locations).toEqual({ countries: ['BR'] });
    expect(logs.some((l) => l.includes('AMAZONAS'))).toBe(true);
  });

  it('segmentação sem geo_locations passa intacta', async () => {
    logs.length = 0;
    const { svc } = svcWithGeo([]);
    const t = { age_min: 25, age_max: 55 };
    expect(await svc.resolveTargetingGeo(t, log)).toEqual(t);
  });
});
