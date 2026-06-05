import { describe, it, expect } from 'vitest';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

describe('formatCurrency', () => {
  it('formata valores em reais', () => {
    // Intl.NumberFormat pt-BR usa espaço não-quebrável — comparamos sem separadores
    expect(formatCurrency(1500).replace(/\s/g, ' ')).toBe('R$ 1.500,00');
    expect(formatCurrency(0).replace(/\s/g, ' ')).toBe('R$ 0,00');
    expect(formatCurrency(0.5).replace(/\s/g, ' ')).toBe('R$ 0,50');
  });

  it('formata valores grandes corretamente', () => {
    expect(formatCurrency(10000).replace(/\s/g, ' ')).toBe('R$ 10.000,00');
  });
});

describe('formatNumber', () => {
  it('formata inteiros com separador', () => {
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });
});

describe('formatPercent', () => {
  it('formata porcentagem com casas decimais', () => {
    const result = formatPercent(2.5);
    expect(result).toContain('2');
    expect(result).toContain('%');
  });

  it('formata zero como 0%', () => {
    const result = formatPercent(0);
    expect(result).toContain('0');
    expect(result).toContain('%');
  });
});
