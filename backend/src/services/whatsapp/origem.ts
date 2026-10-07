// De onde veio cada conversa do bot. Até 01/10/2026 a conversa não guardava
// nada sobre a origem — não dava para saber se um lead QUENTE veio do Google,
// da Meta ou do orgânico, nem de qual página ou anúncio. Funções puras: rodam
// no teste sem banco nem rede.

/** Canal de origem gravado na conversa. */
export type CanalDeOrigem =
  | 'meta_whatsapp' // clique em anúncio Meta "clique para o WhatsApp" (CTWA)
  | 'google'        // site, visitante veio de anúncio Google
  | 'meta'          // site, visitante veio de anúncio/post Meta
  | 'organico'      // site, veio de busca orgânica
  | 'outro_site'    // site, veio de link em outro site
  | 'direto';       // site, entrou direto

// O site segurosamazon.com fecha a 1ª mensagem com "(ref. HAP-G)": página
// (2–4 letras) + canal (G/M/O/R/D) — e, desde 01/10/2026, o número da campanha
// quando o link do anúncio o traz: "(ref. HAP-G-21345678901)". Ver
// src/assets/js/site.js de lá: mudar o formato exige mudar os dois.
//
// Desde 07/10/2026 pode vir no fim "~" + o código do clique (10 letras/números
// minúsculos): "(ref. HAP-G-21345678901~k7xq9pz2ab)". O site registra esse
// código com o gclid do anúncio (POST /api/clique) — ver resolverCliqueDoSite.
// Opcional: código antigo, sem ele, continua valendo.
const REF_DO_SITE = /\(ref\.\s*([A-Z]{2,4})-([GMORD])(?:-(\d{6,20}))?(?:~([a-z0-9]{10}))?\)/;

/** Formato do código do clique — o mesmo que o site gera e o /api/clique aceita. */
export const CODIGO_DO_CLIQUE = /^[a-z0-9]{10}$/;
const CANAL_DO_SITE: Record<string, CanalDeOrigem> = {
  G: 'google', M: 'meta', O: 'organico', R: 'outro_site', D: 'direto',
};

export function lerRefDoSite(texto: string): {
  ref: string; pagina: string; canal: CanalDeOrigem; campanhaId: string | null; clique: string | null;
} | null {
  const m = REF_DO_SITE.exec(texto ?? '');
  if (!m) return null;
  return { ref: `${m[1]}-${m[2]}`, pagina: m[1], canal: CANAL_DO_SITE[m[2]], campanhaId: m[3] ?? null, clique: m[4] ?? null };
}

export interface DadosDoAnuncio {
  /** Click id do anúncio CTWA — é o que a CAPI usa para atribuir o Lead ao anúncio. */
  ctwaClid: string | null;
  /** ID do anúncio (sourceId do externalAdReply), quando vem. */
  anuncioId: string | null;
}

/**
 * Procura os dados do anúncio CTWA na mensagem crua do provedor.
 *
 * A Meta manda o referral SÓ na primeira mensagem de quem clicou no anúncio.
 * No protocolo do WhatsApp ele vem em `contextInfo.externalAdReply`
 * ({ ctwaClid, sourceId, sourceType, ... }); a Evolution repassa o
 * `contextInfo` dentro da mensagem ou no topo de `data`, dependendo da versão.
 * Por isso a busca é por chave, em profundidade limitada — e não por um
 * caminho fixo que um dia muda e para de achar em silêncio.
 */
export function extrairDadosDoAnuncio(raw: unknown): DadosDoAnuncio | null {
  const achado = procurar(raw, 'externalAdReply', 6);
  if (!achado || typeof achado !== 'object') return null;
  const ad = achado as Record<string, unknown>;
  const ctwaClid = texto(ad.ctwaClid) ?? texto(ad.ctwa_clid);
  const anuncioId = texto(ad.sourceId) ?? texto(ad.source_id);
  if (!ctwaClid && !anuncioId) return null;
  return { ctwaClid, anuncioId };
}

/** true se a mensagem tem cara de vir de anúncio (para o log de diagnóstico). */
export function pareceAnuncio(raw: unknown): boolean {
  return procurar(raw, 'externalAdReply', 6) != null || procurar(raw, 'conversionSource', 6) != null;
}

function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s ? s.slice(0, 500) : null;
}

function procurar(obj: unknown, chave: string, prof: number): unknown {
  if (prof < 0 || obj == null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = procurar(x, chave, prof - 1); if (r !== undefined) return r; }
    return undefined;
  }
  const o = obj as Record<string, unknown>;
  if (chave in o && o[chave] != null) return o[chave];
  for (const v of Object.values(o)) { const r = procurar(v, chave, prof - 1); if (r !== undefined) return r; }
  return undefined;
}

export interface OrigemDaConversa {
  origemCanal: CanalDeOrigem | null;
  origemRef: string | null;
  ctwaClid: string | null;
  origemAnuncioId: string | null;
  /**
   * Campanha que trouxe o lead. Do site vem pronta no código; do anúncio CTWA
   * fica null aqui e é resolvida depois pela Meta (resolverCampanhaDoAnuncio).
   */
  origemCampanhaId: string | null;
  /** Código do clique registrado pelo site (gclid guardado em CliqueDoSite). */
  origemClique: string | null;
}

/** Anúncio CTWA tem prioridade: é prova direta. O código do site vem depois. */
export function resolverOrigem(textoDaMensagem: string, anuncio: DadosDoAnuncio | null): OrigemDaConversa {
  const site = lerRefDoSite(textoDaMensagem);
  return {
    origemCanal: anuncio ? 'meta_whatsapp' : site?.canal ?? null,
    origemRef: site?.ref ?? null,
    ctwaClid: anuncio?.ctwaClid ?? null,
    origemAnuncioId: anuncio?.anuncioId ?? null,
    // A campanha do código do site só vale quando o site é a origem: se veio
    // do anúncio CTWA, a campanha é a DO ANÚNCIO, resolvida pela Meta.
    origemCampanhaId: anuncio ? null : site?.campanhaId ?? null,
    origemClique: anuncio ? null : site?.clique ?? null,
  };
}

const ROTULO: Record<CanalDeOrigem, string> = {
  meta_whatsapp: 'anúncio da Meta (clique para o WhatsApp)',
  google: 'anúncio do Google, pelo site',
  meta: 'Facebook/Instagram, pelo site',
  organico: 'busca orgânica, pelo site',
  outro_site: 'link em outro site',
  direto: 'acesso direto ao site',
};

/**
 * Linha para o resumo do vendedor. null quando a origem é desconhecida —
 * inclusive valor que não é um canal conhecido (vem do banco como texto).
 */
export function linhaDeOrigem(o: { origemCanal: string | null; origemRef: string | null }): string | null {
  const rotulo = o.origemCanal ? ROTULO[o.origemCanal as CanalDeOrigem] : undefined;
  if (!rotulo) return null;
  return `Origem: ${rotulo}${o.origemRef ? ` (ref. ${o.origemRef})` : ''}`;
}
