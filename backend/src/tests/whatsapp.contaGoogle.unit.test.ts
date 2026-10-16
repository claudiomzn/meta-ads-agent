// Conta do Google Ads do lead: a da campanha do anúncio (16/10/2026).
import { describe, it, expect } from 'vitest';
import { escolherConta } from '../services/whatsapp/conta.google.js';

const ATIVA = '4131358962';
const MINHAS = [ATIVA, '7285749588', '3004856946'];

describe('escolherConta', () => {
  it('⭐ campanha da 728: a 728, no formato em que o usuário a guarda', () => {
    expect(escolherConta({ campanhaId: '21', contaDaCampanha: '728-574-9588', ativa: ATIVA, minhas: MINHAS }))
      .toEqual({ customerId: '7285749588', origem: 'campanha' });
  });

  it('⭐ sem campanha: a ativa, com aviso', () => {
    expect(escolherConta({ campanhaId: null, contaDaCampanha: null, ativa: ATIVA, minhas: MINHAS }))
      .toMatchObject({ customerId: ATIVA, origem: 'ativa', aviso: expect.any(String) });
  });

  it('⭐ campanha fora da tabela: a ativa, com aviso que cita a campanha', () => {
    const r = escolherConta({ campanhaId: '21', contaDaCampanha: null, ativa: ATIVA, minhas: MINHAS });
    expect(r).toMatchObject({ customerId: ATIVA, origem: 'ativa' });
    expect(r.aviso).toContain('21');
  });

  it('⭐ campanha de conta alheia: nunca essa conta', () => {
    const r = escolherConta({ campanhaId: '21', contaDaCampanha: '1112223334', ativa: ATIVA, minhas: MINHAS });
    expect(r).toMatchObject({ customerId: ATIVA, origem: 'ativa' });
    expect(r.aviso).toContain('não é deste usuário');
  });

  it('sem conta nenhuma: null — nunca o env da casa', () => {
    expect(escolherConta({ campanhaId: null, contaDaCampanha: null, ativa: null, minhas: [] }).customerId).toBeNull();
  });
});
