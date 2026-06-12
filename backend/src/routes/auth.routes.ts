import prisma from '../lib/prisma.js';
import { Router, Request, Response } from 'express';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authRateLimit } from '../middleware/rateLimit.middleware.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { sendMail, resetPasswordEmail, welcomeEmail } from '../services/email.service.js';

const router = Router();

const RegisterSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/register', authRateLimit, async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'E-mail já cadastrado' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email, password: hash } });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });

  // E-mail de boas-vindas — dispara em background, não bloqueia resposta
  const { html, text } = welcomeEmail(user.name);
  sendMail({ to: user.email, subject: 'Bem-vindo ao Meta Ads Agent 🚀', html, text }).catch(
    (err) => console.error('[Email] Falha ao enviar boas-vindas:', err),
  );

  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

router.post('/login', authRateLimit, async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// ─── SSO: login automático via conta do AdsGenius (Supabase) ────────────────
// Recebe o access_token da sessão Supabase do usuário, valida direto na API
// do Supabase, e encontra/cria a conta correspondente neste backend pelo
// supabaseUserId (fallback: email). Elimina o segundo login do Meta Ads.

const SsoSchema = z.object({
  access_token: z.string().min(10),
});

router.post('/sso', authRateLimit, async (req: Request, res: Response) => {
  const parsed = SsoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: 'SSO não configurado no servidor' });
    return;
  }

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${parsed.data.access_token}`,
      apikey: supabaseAnonKey,
    },
  });
  if (!userResp.ok) {
    res.status(401).json({ error: 'Sessão do AdsGenius inválida ou expirada' });
    return;
  }
  const supaUser = await userResp.json() as { id: string; email: string; user_metadata?: { full_name?: string } };
  if (!supaUser.email) {
    res.status(400).json({ error: 'Conta do AdsGenius sem email' });
    return;
  }

  let user = await prisma.user.findUnique({ where: { supabaseUserId: supaUser.id } });
  if (!user) {
    // Vincula pelo email se já existia uma conta separada deste backend
    user = await prisma.user.findUnique({ where: { email: supaUser.email.toLowerCase() } });
    if (user) {
      user = await prisma.user.update({ where: { id: user.id }, data: { supabaseUserId: supaUser.id } });
    } else {
      const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      user = await prisma.user.create({
        data: {
          email: supaUser.email.toLowerCase(),
          password: randomPassword,
          name: supaUser.user_metadata?.full_name ?? supaUser.email.split('@')[0],
          supabaseUserId: supaUser.id,
        },
      });
    }
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }
  res.json(user);
});

// Renova o token sem precisar de senha — basta estar autenticado.
// Retorna um novo JWT com mais 7 dias a partir de agora.
router.post('/refresh', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token, user });
});

// ─── Trocar senha (usuário logado) ───────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Nova senha deve ter pelo menos 6 caracteres'),
});

router.put('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Senha atual incorreta' });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash, passwordChangedAt: new Date() },
  });

  res.json({ success: true });
});

// ─── Esqueci minha senha ──────────────────────────────────────────────────────
// Gera um token de reset e retorna o link. Como não há serviço de e-mail
// configurado, o link é retornado na resposta para o usuário copiar/compartilhar.
// Para ativar envio por e-mail, basta chamar um mailer aqui com resetUrl.

router.post('/forgot-password', authRateLimit, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'E-mail é obrigatório' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Sempre retorna sucesso para não vazar se o e-mail existe
  if (!user) {
    res.json({ success: true, message: 'Se o e-mail estiver cadastrado, você receberá o link.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: token, passwordResetExpiry: expiry },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  // Tenta enviar por e-mail — se SMTP não configurado, cai no log do console
  const { html, text } = resetPasswordEmail(resetUrl, user.name);
  await sendMail({
    to: user.email,
    subject: 'Redefinir senha — Meta Ads Agent',
    html,
    text,
  }).catch((err) => console.error('[Email] Falha ao enviar reset:', err));

  const isDev = process.env.NODE_ENV !== 'production';
  res.json({
    success: true,
    message: isDev
      ? 'Link de redefinição gerado. Verifique o console do servidor se o SMTP não estiver configurado.'
      : 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.',
    ...(isDev && { resetUrl }),
  });
});

// ─── Redefinir senha com token ────────────────────────────────────────────────

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6, 'Nova senha deve ter pelo menos 6 caracteres'),
});

router.post('/reset-password', authRateLimit, async (req: Request, res: Response) => {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { token, newPassword } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    res.status(400).json({ error: 'Token inválido ou expirado. Solicite um novo link.' });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hash,
      passwordResetToken: null,
      passwordResetExpiry: null,
      passwordChangedAt: new Date(), // invalida todos os tokens anteriores
    },
  });

  res.json({ success: true });
});

export default router;
