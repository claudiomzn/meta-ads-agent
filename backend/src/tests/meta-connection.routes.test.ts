import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import metaConnectionRoutes from '../routes/meta-connection.routes.js';

const { mockListTokenAdAccountIds } = vi.hoisted(() => ({
  mockListTokenAdAccountIds: vi.fn(),
}));

vi.mock('../lib/metaAdAccounts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/metaAdAccounts.js')>();
  return { ...actual, listTokenAdAccountIds: mockListTokenAdAccountIds };
});

vi.mock('../services/audit.service.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/email.service.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/meta-connection', metaConnectionRoutes);

const clientEmail = 'meta-request-client@test.com';
const founderEmail = 'meta-request-founder@test.com';
let clientToken = '';
let founderToken = '';
let requestId = '';

beforeAll(async () => {
  process.env.META_PARTNER_BUSINESS_ID = '123456789012345';
  process.env.FOUNDER_EMAILS = founderEmail;

  await prisma.user.deleteMany({ where: { email: { in: [clientEmail, founderEmail] } } });
  const [client, founder] = await Promise.all([
    request(app).post('/api/auth/register').send({
      name: 'Cliente Meta',
      email: clientEmail,
      password: 'senha123',
    }),
    request(app).post('/api/auth/register').send({
      name: 'Fundador',
      email: founderEmail,
      password: 'senha123',
    }),
  ]);
  clientToken = client.body.token;
  founderToken = founder.body.token;
});

afterAll(async () => {
  delete process.env.META_PARTNER_VERIFY_TOKEN;
  await prisma.user.deleteMany({ where: { email: { in: [clientEmail, founderEmail] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockListTokenAdAccountIds.mockResolvedValue(new Set(['9876543210']));
});

describe('fluxo de conexão Meta assistida', () => {
  it('exige autenticação e IDs válidos', async () => {
    const unauthenticated = await request(app).get('/api/meta-connection/request');
    expect(unauthenticated.status).toBe(401);

    const invalid = await request(app)
      .post('/api/meta-connection/request')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        businessPortfolioId: 'inválido',
        adAccountId: '9876543210',
      });
    expect(invalid.status).toBe(400);
  });

  it('cria a solicitação com apenas o id da conta de anúncios', async () => {
    // O cliente não informa mais o id do portfólio: quem pede o acesso é o
    // AdsGenius, e ele só aceita. Exigir o portfólio obrigava a percorrer as
    // Configurações do negócio, que é onde o cliente leigo desistia.
    const response = await request(app)
      .post('/api/meta-connection/request')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ adAccountId: 'act_5551234567' });

    expect(response.status).toBe(201);
    expect(response.body.request.adAccountId).toBe('5551234567');
    expect(response.body.request.businessPortfolioId).toBeNull();

    // Libera o índice parcial de "uma solicitação aberta por cliente" para os
    // casos seguintes.
    await request(app)
      .post(`/api/meta-connection/request/${response.body.request.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`);
  });

  it('cria uma solicitação sem aceitar ou devolver credenciais', async () => {
    const response = await request(app)
      .post('/api/meta-connection/request')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        businessName: 'Empresa Teste',
        businessPortfolioId: '1234567890',
        adAccountId: 'act_9876543210',
        accessToken: 'este-campo-deve-ser-ignorado',
      });

    expect(response.status).toBe(201);
    expect(response.body.request.adAccountId).toBe('9876543210');
    expect(response.body.request).not.toHaveProperty('accessToken');
    expect(response.body.request).not.toHaveProperty('adminNotes');
    requestId = response.body.request.id;
  });

  it('mantém notas internas fora da resposta do cliente', async () => {
    process.env.META_PARTNER_VERIFY_TOKEN = 'token-verificador-somente-leitura';
    const verification = await request(app)
      .post(`/api/meta-connection/request/${requestId}/verify`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(verification.status).toBe(200);
    expect(verification.body.verification).toBe('verified');
    expect(verification.body.request.partnerAccessVerifiedAt).toBeTruthy();

    const update = await request(app)
      .patch(`/api/meta-connection/admin/requests/${requestId}`)
      .set('Authorization', `Bearer ${founderToken}`)
      .send({
        status: 'needs_adjustment',
        adminNotes: 'nota exclusivamente interna',
        customerMessage: 'Compartilhe a conta de anúncios com o parceiro.',
      });
    expect(update.status).toBe(200);

    const clientView = await request(app)
      .get('/api/meta-connection/request')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientView.status).toBe(200);
    expect(clientView.body.request.customerMessage).toMatch(/Compartilhe/);
    expect(clientView.body.request).not.toHaveProperty('adminNotes');
  });

  it('só conclui depois de provar que a credencial alcança a conta solicitada', async () => {
    mockListTokenAdAccountIds.mockResolvedValueOnce(new Set(['1111111111']));
    const denied = await request(app)
      .post(`/api/meta-connection/admin/requests/${requestId}/complete`)
      .set('Authorization', `Bearer ${founderToken}`)
      .send({ accessToken: `EAA${'x'.repeat(40)}` });
    expect(denied.status).toBe(403);

    const completed = await request(app)
      .post(`/api/meta-connection/admin/requests/${requestId}/complete`)
      .set('Authorization', `Bearer ${founderToken}`)
      .send({ accessToken: `EAA${'y'.repeat(40)}` });
    expect(completed.status).toBe(200);

    const clientView = await request(app)
      .get('/api/meta-connection/request')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientView.body.connected).toBe(true);
    expect(clientView.body.connectedAdAccountIds).toEqual(['9876543210']);
  });
});
