import rateLimit from 'express-rate-limit';
import type { AuthRequest } from './auth.middleware.js';

// Rotas de escrita no Meta: máximo 10 publicações por hora
export const publishRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Limite de publicações atingido. Máximo 10 por hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rotas de autenticação: máximo 10 tentativas por 15 minutos
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// O assistente de onboarding é curto por definição. Além de controlar custo,
// este teto impede transformar uma ajuda contextual em chat geral.
export const connectionAssistantRateLimit = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).userId ?? req.ip ?? 'unknown',
  message: {
    error: 'Você concluiu as 10 perguntas desta orientação. Continue pelos passos exibidos.',
    code: 'CONNECTION_GUIDE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const connectionVerificationRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyGenerator: (req) => (req as AuthRequest).userId ?? req.ip ?? 'unknown',
  message: {
    error: 'A verificação já está em andamento. Aguarde alguns minutos.',
    code: 'CONNECTION_VERIFICATION_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
