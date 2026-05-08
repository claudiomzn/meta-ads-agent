import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';
import campaignRoutes from '../routes/campaigns.routes.js';

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);

let token: string;
let userId: string;

beforeAll(async () => {
  await prisma.campaign.deleteMany({ where: { userId: { contains: 'test' } } });
  await prisma.user.deleteMany({ where: { email: 'campaigns@test.com' } });

  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Campaign Test', email: 'campaigns@test.com', password: 'senha123' });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: 'campaigns@test.com' } });
  await prisma.$disconnect();
});

describe('GET /api/campaigns', () => {
  it('retorna lista vazia para novo usuário', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejeita sem autenticação', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/campaigns', () => {
  it('cria campanha simples', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Campanha A', product: 'Produto X', objective: 'LEAD_GENERATION', budget: 1000 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Campanha A');
    expect(res.body.id).toBeDefined();
  });

  it('cria campanha com adSets e ads aninhados', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Campanha Completa',
        product: 'Produto Y',
        objective: 'CONVERSIONS',
        budget: 3000,
        adSets: [
          {
            name: 'Conjunto 1',
            dailyBudget: 100,
            targeting: { age_min: 25, age_max: 45 },
            optimizationGoal: 'CONVERSIONS',
            billingEvent: 'IMPRESSIONS',
            ads: [
              {
                name: 'Anúncio 1',
                headline: 'Descubra o método',
                bodyText: 'Texto do anúncio aqui',
                cta: 'LEARN_MORE',
              },
              {
                name: 'Anúncio 2',
                headline: 'Headline alternativa',
                bodyText: 'Outro texto',
                cta: 'SIGN_UP',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.adSets).toHaveLength(1);
    expect(res.body.adSets[0].ads).toHaveLength(2);
    expect(res.body.adSets[0].name).toBe('Conjunto 1');
    expect(res.body.adSets[0].ads[0].headline).toBe('Descubra o método');
  });

  it('rejeita campanha sem campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sem produto' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/campaigns/:id', () => {
  let campaignId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Para buscar', product: 'P', objective: 'TRAFFIC', budget: 500 });
    campaignId = res.body.id;
  });

  it('retorna campanha pelo id', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(campaignId);
  });

  it('retorna 404 para id inexistente', async () => {
    const res = await request(app)
      .get('/api/campaigns/id-que-nao-existe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/campaigns/:id', () => {
  let campaignId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Para editar', product: 'P', objective: 'TRAFFIC', budget: 500 });
    campaignId = res.body.id;
  });

  it('atualiza nome da campanha', async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nome atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nome atualizado');
  });
});

describe('DELETE /api/campaigns/:id', () => {
  let campaignId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Para deletar', product: 'P', objective: 'TRAFFIC', budget: 500 });
    campaignId = res.body.id;
  });

  it('deleta campanha existente', async () => {
    const del = await request(app)
      .delete(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(404);
  });
});

describe('Isolamento entre usuários', () => {
  let otherToken: string;
  let campaignId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'other@test.com' } });
    const other = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other', email: 'other@test.com', password: 'senha123' });
    otherToken = other.body.token;

    const camp = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Privada', product: 'P', objective: 'TRAFFIC', budget: 100 });
    campaignId = camp.body.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'other@test.com' } });
  });

  it('usuário não vê campanha de outro usuário', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('usuário não deleta campanha de outro usuário', async () => {
    const res = await request(app)
      .delete(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});
