import rateLimit from 'express-rate-limit';

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
