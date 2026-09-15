// Trava o bug de 15/09/2026: variáveis certas, Evolution no ar, e o bloco de
// conexão sumia da tela do cliente. Causa: qualquer falha ao CONSULTAR a
// Evolution (timeout, chave recusada, DNS) virava 500, e o frontend tratava
// 500 como "recurso indisponível" — escondendo o botão de conectar junto com
// o erro real. A rota agora nunca deixa a falha de consulta virar 500: ela é
// reportada como `state: 'error'` com o motivo, e o recurso continua
// `available: true` (a integração existe; foi a chamada que falhou).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';

const mockGetConnectionState = vi.fn();
vi.mock('../services/whatsapp/evolution.manager.js', () => ({
  evolutionConfigured: () => true,
  getConnectionState: (...args: unknown[]) => mockGetConnectionState(...args),
  connectInstance: vi.fn(),
  disconnectInstance: vi.fn(),
  webhookUrl: () => 'https://example.test/webhook',
}));

// eslint-disable-next-line import/first
import whatsappRoutes from '../routes/whatsapp.routes.js';
// eslint-disable-next-line import/first
import authRoutes from '../routes/auth.routes.js';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'wa-evo-status@test.com' } });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'WA Evo Status', email: 'wa-evo-status@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('GET /whatsapp/evolution/status — nunca esconde o recurso por causa de uma falha de consulta', () => {
  it('Evolution respondendo: available true, state e connected refletem a resposta real', async () => {
    mockGetConnectionState.mockResolvedValueOnce('open');
    const res = await request(app)
      .get('/api/whatsapp/evolution/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, state: 'open', connected: true });
  });

  it('Evolution hibernando/timeout/chave recusada: 200 (nunca 500), available continua true, state="error" com o motivo', async () => {
    mockGetConnectionState.mockRejectedValueOnce(new Error('Evolution connectionState 401: chave inválida'));
    const res = await request(app)
      .get('/api/whatsapp/evolution/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.connected).toBe(false);
    expect(res.body.state).toBe('error');
    expect(res.body.error).toContain('chave inválida');
  });

  it('o motivo devolvido nunca ultrapassa 200 caracteres (não vaza stack trace inteiro pro cliente)', async () => {
    mockGetConnectionState.mockRejectedValueOnce(new Error('x'.repeat(500)));
    const res = await request(app)
      .get('/api/whatsapp/evolution/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.error.length).toBeLessThanOrEqual(200);
  });
});
