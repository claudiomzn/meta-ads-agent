import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCESS_CACHE_MAX_ENTRIES,
  ACCESS_CACHE_TTL_MS,
  ACCESS_GRACE_MS,
  clearAccessCache,
  hasAccessGrace,
  readFreshAccess,
  rememberAccess,
} from './subscriptionAccessCache.js';

beforeEach(() => {
  clearAccessCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('veredito corrente', () => {
  it('devolve null quando nunca foi consultado', () => {
    expect(readFreshAccess('user-1')).toBeNull();
  });

  it('devolve o veredito dentro do TTL', () => {
    rememberAccess('user-1', true);
    expect(readFreshAccess('user-1')).toBe(true);

    rememberAccess('user-2', false);
    expect(readFreshAccess('user-2')).toBe(false);
  });

  it('força nova consulta depois do TTL', () => {
    rememberAccess('user-1', true);
    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    expect(readFreshAccess('user-1')).toBeNull();
  });

  it('não renova o TTL apenas porque o valor foi lido', () => {
    rememberAccess('user-1', true);
    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS - 5_000);
    expect(readFreshAccess('user-1')).toBe(true);

    vi.advanceTimersByTime(5_001);
    expect(readFreshAccess('user-1')).toBeNull();
  });
});

describe('tolerância durante falha do Supabase', () => {
  it('cobre quem foi aprovado, mesmo depois do TTL', () => {
    rememberAccess('pagante', true);
    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);

    // O veredito corrente já venceu, mas a tolerância segura o cliente pagante.
    expect(readFreshAccess('pagante')).toBeNull();
    expect(hasAccessGrace('pagante')).toBe(true);
  });

  it('expira 15 minutos depois da aprovação', () => {
    rememberAccess('pagante', true);
    vi.advanceTimersByTime(ACCESS_GRACE_MS - 1_000);
    expect(hasAccessGrace('pagante')).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(hasAccessGrace('pagante')).toBe(false);
  });

  it('nunca cobre quem foi reprovado', () => {
    // Trial vencido não ganha 15 minutos extras só porque o Supabase caiu.
    rememberAccess('expirado', false);
    expect(hasAccessGrace('expirado')).toBe(false);

    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    expect(hasAccessGrace('expirado')).toBe(false);
  });

  it('não cobre quem nunca foi consultado neste processo', () => {
    // Caso real: o Render reinicia a instância e o cache nasce vazio.
    expect(hasAccessGrace('desconhecido')).toBe(false);
  });

  it('uma reprovação posterior cancela a tolerância', () => {
    rememberAccess('cancelou', true);
    expect(hasAccessGrace('cancelou')).toBe(true);

    rememberAccess('cancelou', false);
    expect(hasAccessGrace('cancelou')).toBe(false);
  });
});

describe('teto de entradas', () => {
  it('não passa do limite configurado', () => {
    for (let i = 0; i < ACCESS_CACHE_MAX_ENTRIES + 250; i += 1) {
      rememberAccess(`user-${i}`, true);
    }

    // Sem teto, o Map cresceria com a base de usuários e nunca devolveria
    // memória. Conta indiretamente: as chaves mais antigas saíram.
    expect(readFreshAccess('user-0')).toBeNull();
    expect(readFreshAccess(`user-${ACCESS_CACHE_MAX_ENTRIES + 249}`)).toBe(true);
  });

  it('mantém em uso a chave lida recentemente', () => {
    rememberAccess('antiga', true);
    for (let i = 0; i < ACCESS_CACHE_MAX_ENTRIES - 2; i += 1) {
      rememberAccess(`filler-${i}`, true);
    }
    // Lê a antiga para marcá-la como recém-usada antes de lotar de novo.
    expect(readFreshAccess('antiga')).toBe(true);
    rememberAccess('nova-1', true);
    rememberAccess('nova-2', true);

    expect(readFreshAccess('antiga')).toBe(true);
  });
});
