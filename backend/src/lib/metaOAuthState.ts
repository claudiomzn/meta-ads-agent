import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const META_OAUTH_COOKIE = 'meta_oauth_nonce';
// 10 minutos era curto demais para o fluxo real: escolher Página, revisar as
// 4 permissões e concluir na tela da Meta leva mais que um clique rápido —
// confirmado ao vivo (16/09/2026) com `TokenExpiredError: jwt expired` numa
// tentativa genuína, não travada em nenhuma etapa.
export const META_OAUTH_MAX_AGE_MS = 30 * 60_000;

interface MetaOAuthPayload {
  purpose?: string;
  userId?: string;
  nonce?: string;
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createMetaOAuthState(
  userId: string,
  secret: string,
): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(32).toString('hex');
  const state = jwt.sign(
    { purpose: 'meta_oauth', userId, nonce },
    secret,
    { expiresIn: '30m' },
  );
  return { state, nonce };
}

/**
 * Além de validar a assinatura, exige o nonce HttpOnly criado no navegador que
 * iniciou o fluxo. Um state válido copiado para outro navegador deixa de poder
 * vincular a conta Meta da vítima à conta AdsGenius do atacante.
 */
export function verifyMetaOAuthState(
  state: string,
  cookieHeader: string | undefined,
  secret: string,
): { userId: string } {
  const payload = jwt.verify(state, secret) as MetaOAuthPayload;
  const cookieNonce = readCookie(cookieHeader, META_OAUTH_COOKIE);
  if (
    payload.purpose !== 'meta_oauth' ||
    !payload.userId ||
    !payload.nonce ||
    !cookieNonce ||
    !safeEqual(payload.nonce, cookieNonce)
  ) {
    throw new Error('OAuth inválido');
  }
  return { userId: payload.userId };
}
