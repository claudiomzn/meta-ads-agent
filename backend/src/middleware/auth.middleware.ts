import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { getSubscriptionAccess } from '../services/plan.service.js';

import {
  hasAccessGrace,
  readFreshAccess,
  rememberAccess,
} from '../lib/subscriptionAccessCache.js';

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token não fornecido' });
    return;
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; iat?: number };

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { passwordChangedAt: true, supabaseUserId: true, email: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Verifica se o token foi emitido antes da última troca de senha (revogação implícita)
    if (payload.iat && user.passwordChangedAt) {
        const tokenIssuedAt = payload.iat * 1000; // iat é em segundos
        if (tokenIssuedAt < user.passwordChangedAt.getTime()) {
          res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
          return;
        }
    }

    // O backend Meta não possui plano próprio: toda sessão precisa continuar
    // elegível no AdsGenius. Isso revoga acesso logo após trial/ciclo expirar.
    if (process.env.NODE_ENV !== 'test') {
      const cacheKey = user.supabaseUserId ?? payload.userId;
      const cached = readFreshAccess(cacheKey);
      const access = cached !== null
        ? { allowed: cached, reason: cached ? 'paid' : 'expired' }
        : await getSubscriptionAccess(user.supabaseUserId, user.email);

      if (access.reason === 'unavailable') {
        // Não deu para confirmar a assinatura. Quem foi aprovado nos últimos 15
        // minutos segue trabalhando; para os demais o acesso para aqui, porque
        // liberar sem confirmação daria acesso grátis a quem não pagou.
        if (hasAccessGrace(cacheKey)) {
          req.userId = payload.userId;
          next();
          return;
        }
        res.status(503).json({
          error: 'Não foi possível confirmar sua assinatura. Tente novamente.',
          code: 'SUBSCRIPTION_UNAVAILABLE',
        });
        return;
      }

      rememberAccess(cacheKey, access.allowed);

      if (!access.allowed) {
        res.status(403).json({
          error: 'Seu acesso ao AdsGenius expirou. Regularize sua assinatura para continuar.',
          code: 'SUBSCRIPTION_REQUIRED',
        });
        return;
      }
    }

    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
