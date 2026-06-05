import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

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

    // Verifica se o token foi emitido antes da última troca de senha (revogação implícita)
    if (payload.iat) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { passwordChangedAt: true },
      });
      if (user?.passwordChangedAt) {
        const tokenIssuedAt = payload.iat * 1000; // iat é em segundos
        if (tokenIssuedAt < user.passwordChangedAt.getTime()) {
          res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
          return;
        }
      }
    }

    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
