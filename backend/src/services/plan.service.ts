// Consulta o plano do usuário (trial/pro/agency) na tabela user_profiles do
// Supabase (fonte da verdade do AdsGenius/google-ads-agent).
//
// Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (já usados pelo storage.service).
// Sem essas envs, ou se o usuário não tiver supabaseUserId vinculado, ou se a
// consulta falhar, retorna null — e o chamador deve tratar como trial
// (postura mais segura para controle de custo).

export async function getUserPlan(supabaseUserId: string | null | undefined): Promise<string | null> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey || !supabaseUserId) return null;

  try {
    const res = await fetch(
      `${base}/rest/v1/user_profiles?user_id=eq.${supabaseUserId}&select=plan`,
      { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    );
    if (!res.ok) return null;

    const rows = (await res.json()) as { plan?: string }[];
    return rows[0]?.plan ?? null;
  } catch (err) {
    console.error('[plan.service] Erro ao consultar plano:', err);
    return null;
  }
}

export function isPaidPlan(plan: string | null): boolean {
  return plan === 'pro' || plan === 'agency';
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
