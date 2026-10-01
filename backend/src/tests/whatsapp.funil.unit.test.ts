import { describe, expect, it } from 'vitest';
import { periodo, somarFunil } from '../services/whatsapp/funil.js';

const l = (origemCanal: string | null, origemCampanhaId: string | null, label: string | null, n: number) =>
  ({ origemCanal, origemCampanhaId, label, _count: { _all: n } });

describe('somarFunil', () => {
  it('⭐ uma linha por (canal, campanha): leads somam todos os rótulos, quentes só QUENTE', () => {
    const r = somarFunil([
      l('google', '111', 'QUENTE', 3), l('google', '111', 'FRIO', 5), l('google', '111', null, 2),
      l('meta_whatsapp', '999', 'QUENTE', 1),
      l(null, null, 'QUENTE', 4),
    ]);
    expect(r[0]).toEqual({ canal: 'google', campanhaId: '111', leads: 10, quentes: 3 });
    expect(r).toContainEqual({ canal: 'meta_whatsapp', campanhaId: '999', leads: 1, quentes: 1 });
    expect(r[r.length - 1]).toEqual({ canal: null, campanhaId: null, leads: 4, quentes: 4 }); // desconhecida por último
  });

  it('vazio → vazio', () => expect(somarFunil([])).toEqual([]));
});

describe('periodo (datas de Manaus)', () => {
  const agora = Date.parse('2026-10-01T15:00:00Z'); // 11h em Manaus
  it('padrão: últimos 30 dias até o fim de hoje', () => {
    const p = periodo(undefined, undefined, agora)!;
    expect(p.ate.toISOString()).toBe('2026-10-02T04:00:00.000Z');
    expect(p.de.toISOString()).toBe('2026-09-02T04:00:00.000Z');
  });
  it('intervalo explícito, fim inclusivo', () => {
    const p = periodo('2026-09-01', '2026-09-30', agora)!;
    expect(p.de.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });
  it.each([['01/09/2026', undefined], ['2026-09-30', '2026-09-01'], [undefined, 'ontem']])(
    'inválido %s..%s → null', (d, a) => expect(periodo(d, a, agora)).toBeNull());
});
