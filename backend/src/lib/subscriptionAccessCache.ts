// Cache de elegibilidade de assinatura, com janela de tolerância.
//
// Duas necessidades diferentes convivem aqui:
//
// 1. TTL curto (30s) — evita uma consulta ao Supabase por request, sem atrasar
//    muito a revogação de quem cancelou ou teve o trial expirado.
//
// 2. Janela de tolerância (15min) — quando o Supabase está inacessível não é
//    possível afirmar nada sobre a assinatura. Bloquear todo mundo transforma um
//    soluço de rede em queda geral para clientes pagantes; liberar todo mundo dá
//    acesso grátis a quem não pagou. O meio: quem foi APROVADO há pouco continua
//    passando por até 15 minutos; quem foi reprovado, ou de quem não se sabe
//    nada, é bloqueado.
//
// A tolerância só vale para respostas positivas — uma reprovação nunca é
// estendida. E ela é por processo: o Render reinicia o serviço com frequência
// (instância free), e depois de um reinício o cache nasce vazio, então uma queda
// do Supabase volta a bloquear. É uma rede de segurança, não uma garantia.

export const ACCESS_CACHE_MAX_ENTRIES = 5_000;
export const ACCESS_CACHE_TTL_MS = 30_000;
export const ACCESS_GRACE_MS = 15 * 60_000;

interface AccessEntry {
  allowed: boolean;
  /** Até quando a resposta serve como verdade corrente. */
  expiresAt: number;
  /** Até quando serve como último recurso, se a consulta falhar. 0 = nunca. */
  graceUntil: number;
}

const accessCache = new Map<string, AccessEntry>();

/** Só para testes: zera o estado entre casos. */
export function clearAccessCache(): void {
  accessCache.clear();
}

function touch(key: string, entry: AccessEntry): void {
  // Map itera na ordem de inserção; reinserir mantém o mais antigo em uso na
  // frente, o que faz o descarte por lotação virar LRU.
  accessCache.delete(key);
  accessCache.set(key, entry);
}

function evictIfNeeded(): void {
  if (accessCache.size < ACCESS_CACHE_MAX_ENTRIES) return;

  const now = Date.now();
  for (const [key, entry] of accessCache) {
    // Uma entrada só é descartável quando não serve nem como valor corrente
    // nem como tolerância.
    if (entry.expiresAt <= now && entry.graceUntil <= now) accessCache.delete(key);
  }
  while (accessCache.size >= ACCESS_CACHE_MAX_ENTRIES) {
    const oldest = accessCache.keys().next();
    if (oldest.done) break;
    accessCache.delete(oldest.value);
  }
}

/** Registra o veredito de uma consulta bem-sucedida. */
export function rememberAccess(key: string, allowed: boolean): void {
  accessCache.delete(key);
  evictIfNeeded();

  const now = Date.now();
  accessCache.set(key, {
    allowed,
    expiresAt: now + ACCESS_CACHE_TTL_MS,
    graceUntil: allowed ? now + ACCESS_GRACE_MS : 0,
  });
}

/** Veredito ainda válido, ou `null` se não há (força nova consulta). */
export function readFreshAccess(key: string): boolean | null {
  const entry = accessCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt > now) {
    touch(key, entry);
    return entry.allowed;
  }
  // Expirou como valor corrente, mas pode ainda servir de tolerância.
  if (entry.graceUntil <= now) accessCache.delete(key);
  return null;
}

/**
 * `true` quando o usuário foi aprovado há menos de 15 minutos — a única
 * situação em que se libera acesso sem conseguir confirmar a assinatura.
 */
export function hasAccessGrace(key: string): boolean {
  const entry = accessCache.get(key);
  if (!entry) return false;

  const now = Date.now();
  if (entry.graceUntil > now && entry.allowed) return true;
  if (entry.expiresAt <= now && entry.graceUntil <= now) accessCache.delete(key);
  return false;
}
