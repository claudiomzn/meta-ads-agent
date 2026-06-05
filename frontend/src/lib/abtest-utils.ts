/**
 * Calcula significância estatística de um teste A/B usando teste Z bilateral.
 * Retorna confiança em % e o vencedor ('A' | 'B' | null).
 */
export function calcSignificance(
  n1: number,
  c1: number,
  n2: number,
  c2: number,
): { significant: boolean; confidence: number; winner: 'A' | 'B' | null } {
  if (n1 < 100 || n2 < 100) return { significant: false, confidence: 0, winner: null };

  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pPool = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));

  if (se === 0) return { significant: false, confidence: 0, winner: null };

  const z = Math.abs(p1 - p2) / se;
  const confidence =
    z > 2.576 ? 99 :
    z > 1.96  ? 95 :
    z > 1.645 ? 90 :
    Math.round((z / 1.96) * 95);

  return {
    significant: z > 1.96,
    confidence,
    winner: p1 >= p2 ? 'A' : 'B',
  };
}
