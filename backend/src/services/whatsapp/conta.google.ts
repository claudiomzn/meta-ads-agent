// Em qual conta do Google Ads mora o lead: a do ANÚNCIO que o trouxe.
//
// Até 16/10/2026 o lead QUENTE e a venda informada pelo vendedor subiam na
// conta ATIVA da conexão. O Luiz anuncia em três contas — 413-135-8962
// (Tabelasamel), 728-574-9588 ("[Site novo] Planos de Saúde Manaus", do
// segurosamazon.com) e 300-485-6946 —, e o lead da 728 ia para a 413. Com
// gclid o Google recusa (o clique é de outra conta); só com o telefone quase
// nunca casa. Sumia em silêncio.
//
// Fonte real, sem adivinhar: o site manda o ID da campanha Google no
// "(ref. XXX-G-<campanhaId>…)" (origemCampanhaId), e a tabela `campaigns` do
// Supabase, que o sync preenche, diz de qual conta é cada campanha. Não chama
// a API do Google a cada lead.
//
// A conta da campanha só vale se for DO USUÁRIO — o ref vem no texto que o
// lead manda, e qualquer um pode digitar um ID de campanha alheio. A regra
// espelha ownsCustomer (google-ads-agent, _shared/ownership.ts): conexão
// (customer_ids + active_customer_id) e clientes de agência. Do lado de lá,
// upload-lead-conversion e upload-sale-conversion conferem de novo (403).
//
// Sem campanha resolvida: conta ativa, com AVISO. Nunca o env
// GOOGLE_ADS_CUSTOMER_ID (CLAUDE.md: já fez campanha de cliente nascer na
// conta do fundador).

export interface ContaDoLead {
  /** Conta onde a conversão/venda deve morar; null = usuário sem conta Google. */
  customerId: string | null;
  /** 'campanha' = resolvida pelo anúncio; 'ativa' = caiu na conta ativa. */
  origem: 'campanha' | 'ativa';
  /** Por que caiu na ativa — para o log. Ausente quando veio da campanha. */
  aviso?: string;
}

const soDigitos = (id: string) => String(id).replace(/[-\s]/g, '');

/**
 * PURA. Escolhe a conta a partir do que o Supabase respondeu.
 * Devolve a conta no FORMATO em que o usuário a tem guardada — é o que o resto
 * do app usa em closed_sales.customer_id.
 */
export function escolherConta(e: {
  campanhaId: string | null;
  /** customer_id da campanha na tabela `campaigns`; null = não sincronizada. */
  contaDaCampanha: string | null;
  ativa: string | null;
  /** Todas as contas do usuário (conexão + clientes de agência). */
  minhas: string[];
}): ContaDoLead {
  const ativa = e.ativa || null;
  if (!e.campanhaId) {
    return { customerId: ativa, origem: 'ativa', aviso: 'lead sem campanha do Google no ref do site' };
  }
  if (!e.contaDaCampanha) {
    return {
      customerId: ativa, origem: 'ativa',
      aviso: `campanha ${e.campanhaId} não está na tabela campaigns (conta não conectada ou não sincronizada)`,
    };
  }
  const alvo = soDigitos(e.contaDaCampanha);
  const minha = e.minhas.find((c) => soDigitos(c) === alvo);
  if (!minha) {
    return {
      customerId: ativa, origem: 'ativa',
      aviso: `campanha ${e.campanhaId} é da conta ${alvo}, que não é deste usuário`,
    };
  }
  return { customerId: minha, origem: 'campanha' };
}

function headers(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function lerJson<T>(url: string, key: string, oque: string): Promise<T[]> {
  const resp = await fetch(url, { headers: headers(key) });
  if (!resp.ok) throw new Error(`${oque} ilegível (HTTP ${resp.status})`);
  return ((await resp.json().catch(() => [])) as T[]) ?? [];
}

/**
 * Conta do Google Ads do lead, lida do Supabase. `campanhaGoogleId` só quando
 * a origem da conversa é Google — campanha da Meta não mora em `campaigns`.
 * Lança quando o Supabase não responde: quem chama decide o que fazer
 * (a venda pede ao vendedor para mandar de novo).
 */
export async function contaGoogleDoLead(
  base: string, key: string, supabaseUserId: string, campanhaGoogleId: string | null,
): Promise<ContaDoLead> {
  const uid = encodeURIComponent(supabaseUserId);
  const [conexao] = await lerJson<{ active_customer_id?: string | null; customer_ids?: string[] | null }>(
    `${base}/rest/v1/google_ads_connections?user_id=eq.${uid}&select=active_customer_id,customer_ids&limit=1`,
    key, 'conexão Google',
  );
  // Sem conexão Google não há onde a venda/conversão morar — nem adianta
  // procurar a campanha.
  if (!conexao) return { customerId: null, origem: 'ativa', aviso: 'usuário sem conexão Google Ads' };
  const ativa = conexao.active_customer_id ?? null;

  let contaDaCampanha: string | null = null;
  const minhas = [...(conexao.customer_ids ?? []), ...(ativa ? [ativa] : [])];
  if (campanhaGoogleId) {
    const [campanha] = await lerJson<{ customer_id?: string | null }>(
      `${base}/rest/v1/campaigns?id=eq.${encodeURIComponent(campanhaGoogleId)}&select=customer_id&limit=1`,
      key, 'campanha',
    );
    contaDaCampanha = campanha?.customer_id ?? null;
    // Clientes de agência só são lidos quando a conexão não basta.
    if (contaDaCampanha && !minhas.some((c) => soDigitos(c) === soDigitos(contaDaCampanha!))) {
      const clientes = await lerJson<{ google_ads_customer_id?: string | null }>(
        `${base}/rest/v1/agency_clients?agency_user_id=eq.${uid}&select=google_ads_customer_id`,
        key, 'clientes de agência',
      );
      for (const c of clientes) if (c.google_ads_customer_id) minhas.push(c.google_ads_customer_id);
    }
  }

  return escolherConta({ campanhaId: campanhaGoogleId, contaDaCampanha, ativa, minhas });
}
