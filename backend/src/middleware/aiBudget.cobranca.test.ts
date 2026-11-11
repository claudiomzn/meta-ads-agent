// O middleware `aiBudget` só pode LIQUIDAR o crédito quando a IA entregou.
// Rota que trata falha da IA respondendo 200 marca a resposta e a reserva é
// liberada; cliente que fecha a conexão antes do fim também libera.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('../services/email.service.js', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));

import prisma from '../lib/prisma.js';
import { aiBudget, marcarIaNaoEntregue } from './aiBudget.middleware.js';

const CHAVES_ENV = ['NODE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const originalEnv = Object.fromEntries(CHAVES_ENV.map((k) => [k, process.env[k]]));
let fetchMock: ReturnType<typeof vi.fn>;

function rpcChamadas(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url).split('/rpc/')[1]);
}

function app() {
  const a = express();
  a.use((req, _res, next) => {
    (req as { userId?: string }).userId = 'backend-user';
    next();
  });
  a.get('/entregou', aiBudget('agent_quick'), (_req, res) => {
    res.json({ ok: true });
  });
  a.get('/fallback', aiBudget('agent_quick'), (_req, res) => {
    marcarIaNaoEntregue(res, 'IA falhou');
    res.json({ score: 0 });
  });
  a.get('/lento', aiBudget('agent_chat'), (_req, res) => {
    setTimeout(() => { if (!res.writableEnded) res.end(); }, 2000);
  });
  return a;
}

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://supabase.example.com';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    supabaseUserId: '550e8400-e29b-41d4-a716-446655440000',
  } as never);
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('reserve_ai_usage')
        ? { allowed: true, reservation_id: 'res-1' }
        : { send: false },
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of CHAVES_ENV) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('aiBudget — cobra só quando a IA entregou', () => {
  it('liquida quando a rota respondeu com a IA', async () => {
    await request(app()).get('/entregou').expect(200);
    await vi.waitFor(() => expect(rpcChamadas()).toContain('settle_ai_usage'));
    expect(rpcChamadas()).not.toContain('release_ai_usage');
  });

  it('LIBERA quando a rota marcou fallback, mesmo com 200', async () => {
    await request(app()).get('/fallback').expect(200);
    await vi.waitFor(() => expect(rpcChamadas()).toContain('release_ai_usage'));
    expect(rpcChamadas()).not.toContain('settle_ai_usage');
  });

  it('LIBERA quando o cliente fecha a conexão antes do fim (sem `finish`)', async () => {
    const server = app().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) => {
        const req = http.get({ port, path: '/lento' });
        req.on('error', () => resolve());
        // Dá tempo de a reserva acontecer e então derruba a conexão.
        setTimeout(() => { req.destroy(); resolve(); }, 150);
      });
      await vi.waitFor(() => expect(rpcChamadas()).toContain('release_ai_usage'), { timeout: 1500 });
      expect(rpcChamadas()).not.toContain('settle_ai_usage');
    } finally {
      server.close();
    }
  });
});
