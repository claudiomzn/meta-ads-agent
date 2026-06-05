import { describe, it, expect } from 'vitest';
import { audienceToText } from '@/components/AudiencePicker';

const BASE = {
  id: '1',
  name: 'Teste',
  ageMin: 25,
  ageMax: 45,
  gender: 'Feminino',
  locations: 'São Paulo, SP',
  interests: 'Fitness, Saúde',
  behaviors: undefined,
  estimatedSize: undefined,
};

describe('audienceToText', () => {
  it('inclui gênero e faixa etária', () => {
    const text = audienceToText(BASE);
    expect(text).toContain('Feminino');
    expect(text).toContain('25');
    expect(text).toContain('45');
  });

  it('inclui localização quando presente', () => {
    const text = audienceToText(BASE);
    expect(text).toContain('São Paulo');
  });

  it('inclui interesses quando presentes', () => {
    const text = audienceToText(BASE);
    expect(text).toContain('Fitness');
  });

  it('funciona sem localização ou interesses', () => {
    const text = audienceToText({ ...BASE, locations: '', interests: '' });
    expect(text).toContain('Feminino');
    expect(text).not.toContain('|');
  });

  it('formata corretamente com todos os campos', () => {
    const text = audienceToText(BASE);
    // Deve ter pelo menos 2 seções separadas por |
    expect(text.split('|').length).toBeGreaterThanOrEqual(2);
  });
});
