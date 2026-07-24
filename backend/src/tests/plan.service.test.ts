import { describe, it, expect } from 'vitest';
import { resolvePolicy, isPaidPlan } from '../services/plan.service.js';

// A regra deve espelhar a resolução de v_policy em
// google-ads-agent/supabase/migrations/20260724003000_pro_plus_ai_budget.sql:
// a política vem do STATUS, nunca só do nome do plano.
describe('resolvePolicy', () => {
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  it('sem assinatura => trial (conservador)', () => {
    expect(resolvePolicy(null)).toBe('trial');
    expect(resolvePolicy(undefined)).toBe('trial');
  });

  it('status trial => trial, mesmo com plan pago (oferta futura)', () => {
    expect(resolvePolicy({ status: 'trial', plan: 'pro', trial_ends_at: future })).toBe('trial');
    expect(resolvePolicy({ status: 'trial', plan: 'pro_plus', trial_ends_at: future })).toBe('trial');
  });

  it('Pro ativo => pro', () => {
    expect(resolvePolicy({ status: 'active', plan: 'pro' })).toBe('pro');
  });

  it('Pro+ ativo => pro_plus', () => {
    expect(resolvePolicy({ status: 'active', plan: 'pro_plus' })).toBe('pro_plus');
  });

  it('agencia (legado) ativo => pro_plus', () => {
    expect(resolvePolicy({ status: 'active', plan: 'agencia' })).toBe('pro_plus');
  });

  it('cancelled/overdue em período de graça mantêm o tier pago', () => {
    expect(resolvePolicy({ status: 'cancelled', plan: 'pro' })).toBe('pro');
    expect(resolvePolicy({ status: 'overdue', plan: 'pro_plus' })).toBe('pro_plus');
  });

  it('status desconhecido/expirado => trial', () => {
    expect(resolvePolicy({ status: 'expired', plan: 'pro' })).toBe('trial');
    expect(resolvePolicy({ status: 'pending', plan: 'pro_plus' })).toBe('trial');
    expect(resolvePolicy({ status: 'none', plan: 'pro' })).toBe('trial');
  });
});

describe('isPaidPlan', () => {
  it('pro e pro_plus são pagos', () => {
    expect(isPaidPlan('pro')).toBe(true);
    expect(isPaidPlan('pro_plus')).toBe(true);
  });

  it('trial e nulos não são pagos', () => {
    expect(isPaidPlan('trial')).toBe(false);
    expect(isPaidPlan(null)).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });
});
