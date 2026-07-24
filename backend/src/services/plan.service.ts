// Resolve a política/tier de assinatura do usuário a partir da FONTE DE VERDADE
// do AdsGenius: a tabela public.subscriptions (status + plan) no Supabase, com
// fallback para user_profiles.plan === 'founder' (acesso vitalício, gerenciado
// fora de subscriptions).
//
// Espelha a regra de google-ads-agent:
//   - _shared/access.ts (computeAccess: status manda);
//   - _shared/plan-limits.ts (resolveUserPlan: subscriptions é a verdade,
//     founder cai pra user_profiles);
//   - migração 20260724003000_pro_plus_ai_budget.sql (resolução de v_policy:
//     a política vem do STATUS, nunca só do nome do plano — um trial com
//     plan='pro'/'pro_plus' continua sendo trial).
// Se mudar a regra lá, mude aqui.
//
// Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (já usados por storage.service).
// Sem essas envs, sem supabaseUserId, ou se a consulta falhar, retorna 'trial'
// (postura conservadora de custo). NUNCA imprime o valor de nenhum secret.

export type PlanTier = 'trial' | 'pro' | 'pro_plus';

interface SubscriptionRow {
  status?: string | null;
  plan?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

async function fetchSupabaseRest<T>(path: string): Promise<T | null> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return null;

  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    // Nunca logar o valor de nenhum secret — só a natureza do erro.
    console.error('[plan.service] consulta ao Supabase falhou:', err instanceof Error ? err.message : 'erro');
    return null;
  }
}

// Regra pura (sem rede) — espelha a resolução de v_policy da migração de Pro+.
// A política é determinada pelo STATUS; um trial nunca herda os limites do plano
// pago mesmo que subscriptions.plan já seja 'pro'/'pro_plus'.
export function resolvePolicy(sub: SubscriptionRow | null | undefined): PlanTier {
  if (!sub) return 'trial';
  const status = sub.status ?? '';
  const plan = sub.plan ?? '';

  // Trial ativo => trial. Trial vencido também cai em 'trial' (mais restritivo);
  // o bloqueio de acesso propriamente dito é feito pelo gate do frontend/edge —
  // aqui decidimos apenas a política de cota do Estúdio de Criativos.
  if (status === 'trial') return 'trial';

  // 'agencia' é o nome legado do mesmo benefício do Pro+ (R$397, até 3 contas),
  // mantido pra assinantes antigos — recebe a política de Pro+.
  const paid = status === 'active' || status === 'cancelled' || status === 'overdue';
  if (paid && (plan === 'pro_plus' || plan === 'agencia')) return 'pro_plus';
  if (paid && plan === 'pro') return 'pro';

  return 'trial';
}

export async function getUserPlan(supabaseUserId: string | null | undefined): Promise<PlanTier> {
  if (!supabaseUserId) return 'trial';
  const id = encodeURIComponent(supabaseUserId);

  // Founder: acesso vitalício gerenciado à mão (não vem de subscriptions).
  const profiles = await fetchSupabaseRest<{ plan?: string }[]>(
    `user_profiles?user_id=eq.${id}&select=plan`,
  );
  if (profiles?.[0]?.plan === 'founder') return 'pro_plus';

  const subs = await fetchSupabaseRest<SubscriptionRow[]>(
    `subscriptions?user_id=eq.${id}&select=status,plan,trial_ends_at,current_period_end`,
  );
  return resolvePolicy(subs?.[0] ?? null);
}

export function isPaidPlan(plan: PlanTier | string | null | undefined): boolean {
  return plan === 'pro' || plan === 'pro_plus';
}

// Lista de e-mails (separados por vírgula) com acesso vitalício e sem
// limites de cota no Estúdio de Criativos — uso interno/fundador.
const LIFETIME_EMAILS = (process.env.CREATIVE_STUDIO_LIFETIME_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isLifetimeUser(email: string | null | undefined): boolean {
  return !!email && LIFETIME_EMAILS.includes(email.toLowerCase());
}
