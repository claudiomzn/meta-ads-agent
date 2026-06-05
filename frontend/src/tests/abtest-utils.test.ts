import { describe, it, expect } from 'vitest';
import { calcSignificance } from '@/lib/abtest-utils';

describe('calcSignificance', () => {
  it('retorna sem dados se amostras < 100', () => {
    const result = calcSignificance(50, 5, 50, 3);
    expect(result.significant).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.winner).toBeNull();
  });

  it('detecta resultado significativo quando diferença é grande', () => {
    // A: 5% conversão  B: 2% conversão — diferença clara
    const result = calcSignificance(1000, 50, 1000, 20);
    expect(result.significant).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.winner).toBe('A');
  });

  it('B vence quando converte mais', () => {
    const result = calcSignificance(1000, 15, 1000, 45);
    expect(result.winner).toBe('B');
  });

  it('retorna não significativo quando diferença é pequena', () => {
    // A: 3.1%  B: 3.0% — margem pequena
    const result = calcSignificance(1000, 31, 1000, 30);
    expect(result.significant).toBe(false);
  });

  it('retorna se igual quando não há diferença', () => {
    const result = calcSignificance(1000, 30, 1000, 30);
    expect(result.significant).toBe(false);
    // empate — winner pode ser A (p1 >= p2 é verdadeiro)
    expect(result.winner).toBe('A');
  });

  it('retorna 99% de confiança para diferença muito grande', () => {
    const result = calcSignificance(2000, 200, 2000, 40);
    expect(result.confidence).toBe(99);
    expect(result.significant).toBe(true);
  });
});
