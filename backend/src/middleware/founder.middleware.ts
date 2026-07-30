import type { NextFunction, Response } from 'express';
import prisma from '../lib/prisma.js';
import { isFounderEmail } from '../services/plan.service.js';
import type { AuthRequest } from './auth.middleware.js';

export async function founderMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { email: true },
  });
  if (!user || !isFounderEmail(user.email)) {
    res.status(403).json({ error: 'Acesso administrativo necessário.' });
    return;
  }
  next();
}
