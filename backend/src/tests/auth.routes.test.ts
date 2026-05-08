import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth.routes.js';

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use(cors());
app.use('/api/auth', authRoutes);

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: '@test-auth.com' } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: '@test-auth.com' } } });
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('cria usuário e retorna token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test User', email: 'user1@test-auth.com', password: 'senha123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('user1@test-auth.com');
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejeita e-mail duplicado', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'dup@test-auth.com', password: 'senha123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test 2', email: 'dup@test-auth.com', password: 'senha456' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('rejeita campos inválidos', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'nao-é-email', password: '123' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Login Test', email: 'login@test-auth.com', password: 'senha123' });
  });

  it('autentica com credenciais corretas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test-auth.com', password: 'senha123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejeita senha incorreta', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test-auth.com', password: 'errada' });

    expect(res.status).toBe(401);
  });

  it('rejeita e-mail inexistente', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'naoexiste@test-auth.com', password: 'senha123' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Me Test', email: 'me@test-auth.com', password: 'senha123' });
    token = res.body.token;
  });

  it('retorna dados do usuário autenticado', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@test-auth.com');
    expect(res.body.password).toBeUndefined();
  });

  it('rejeita requisição sem token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejeita token inválido', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });
});
