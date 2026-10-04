// Leads e QUENTES por campanha — o "meio do funil" que faltava no relatório
// do app (gasto → LEADS → QUENTES → vendas → retorno). Função pura: recebe as
// linhas agrupadas do banco e devolve uma linha por (canal, campanha).

export interface LinhaAgrupada {
  origemCanal: string | null;
  origemCampanhaId: string | null;
  label: string | null;
  _count: { _all: number };
}

export interface FunilDaCampanha {
  /** null = origem desconhecida (conversa sem código do site nem anúncio). */
  canal: string | null;
  /** null = sabe o canal mas não a campanha (ex.: "HAP-G" sem número). */
  campanhaId: string | null;
  leads: number;
  quentes: number;
}

export function somarFunil(linhas: LinhaAgrupada[]): FunilDaCampanha[] {
  const mapa = new Map<string, FunilDaCampanha>();
  for (const l of linhas) {
    const chave = `${l.origemCanal ?? ''}|${l.origemCampanhaId ?? ''}`;
    const f = mapa.get(chave) ?? { canal: l.origemCanal, campanhaId: l.origemCampanhaId, leads: 0, quentes: 0 };
    f.leads += l._count._all;
    if (l.label === 'QUENTE') f.quentes += l._count._all;
    mapa.set(chave, f);
  }
  // Mais leads primeiro; desconhecida por último — é a que menos ajuda a decidir.
  return [...mapa.values()].sort((a, b) =>
    (a.canal === null ? 1 : 0) - (b.canal === null ? 1 : 0) || b.leads - a.leads);
}

/**
 * Período em datas de Manaus ("AAAA-MM-DD"), fim inclusivo. Padrão: últimos 30
 * dias. Data inválida → null (a rota responde 400, não inventa período).
 */
export function periodo(desde?: unknown, ate?: unknown, agora = Date.now()): { de: Date; ate: Date } | null {
  const dia = /^\d{4}-\d{2}-\d{2}$/;
  const hoje = new Date(agora - 4 * 3_600_000).toISOString().slice(0, 10);
  const d = desde == null || desde === '' ? null : String(desde);
  const a = ate == null || ate === '' ? hoje : String(ate);
  if ((d && !dia.test(d)) || !dia.test(a)) return null;
  const fim = Date.parse(`${a}T00:00:00-04:00`) + 86_400_000; // exclusivo: dia seguinte
  const ini = d ? Date.parse(`${d}T00:00:00-04:00`) : fim - 30 * 86_400_000;
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || ini >= fim) return null;
  return { de: new Date(ini), ate: new Date(fim) };
}

// ── De qual campanha veio esta venda? (04/10/2026) ──────────────────────────
//
// O cliente registra a venda no app com o WhatsApp do comprador. Se esse
// número conversou com o bot, a conversa sabe a origem (canal e campanha) —
// o app pré-seleciona a campanha em vez de pedir que o cliente adivinhe.

/**
 * PURO. Chave de comparação de telefone brasileiro: DDD + 8 últimos dígitos.
 *
 * O mesmo celular aparece de jeitos diferentes: digitado com ou sem 55, e no
 * WhatsApp às vezes SEM o 9º dígito (contas antigas: 559291234567). DDD + os 8
 * finais casa todos. null = não dá para comparar com segurança.
 */
export function chaveDoTelefone(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export interface ConversaComOrigem {
  leadPhone: string;
  origemCanal: string | null;
  origemCampanhaId: string | null;
  origemRef: string | null;
  label: string | null;
  createdAt: Date;
}

export interface OrigemDaVenda {
  canal: string | null;
  campanhaId: string | null;
  ref: string | null;
  rotulo: string | null;
  desde: string;
}

/**
 * PURO. Entre as conversas candidatas, a do MESMO número com origem conhecida
 * mais recente. Sem origem nenhuma (conversa anterior à medição) → null: "não
 * sei" não pode virar "não veio de campanha".
 */
export function origemDaVenda(telefone: string, conversas: ConversaComOrigem[]): OrigemDaVenda | null {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return null;
  const doNumero = conversas
    .filter((c) => chaveDoTelefone(c.leadPhone) === chave && c.origemCanal)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const c = doNumero[0];
  if (!c) return null;
  return { canal: c.origemCanal, campanhaId: c.origemCampanhaId, ref: c.origemRef, rotulo: c.label, desde: c.createdAt.toISOString() };
}
