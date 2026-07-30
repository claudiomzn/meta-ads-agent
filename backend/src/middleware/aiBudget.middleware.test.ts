import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        supabaseUserId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    },
  },
}));

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

import { runWithAiBudget } from './aiBudget.middleware.js';
import prisma from '../lib/prisma.js';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

const originalNodeEnv = process.env.NODE_ENV;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://supabase.example.com';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    supabaseUserId: '550e8400-e29b-41d4-a716-446655440000',
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
});

describe('runWithAiBudget', () => {
  it('mantém o resultado da IA e não libera a reserva se apenas a liquidação falhar', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ allowed: true, reservation_id: 'reservation-1' }))
      .mockResolvedValueOnce(jsonResponse({}, false));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await runWithAiBudget('backend-user', 'agent_quick', async () => 'resposta');

    expect(result).toBe('resposta');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/settle_ai_usage');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/release_ai_usage'))).toBe(false);
  });

  it('libera a reserva quando a operação de IA realmente falha', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ allowed: true, reservation_id: 'reservation-2' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runWithAiBudget('backend-user', 'agent_quick', async () => {
        throw new Error('Anthropic indisponível');
      }),
    ).rejects.toThrow(/Anthropic indisponível/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/release_ai_usage');
  });
});
