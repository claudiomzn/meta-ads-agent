// Cotação na hora para o lead qualificado — integração PERSONALIZADA.
//
// Vale para UMA conta (a da Amazon Corretora, dona do AdsGenius), ligada por
// variáveis de ambiente no Render. Nenhum outro cliente do AdsGenius passa
// por aqui: sem as variáveis, o bot encerra como sempre ("vou passar para um
// consultor"). Não há tela, migration nem campo de configuração — se um dia
// virar produto, aí se faz.
//
// A regra que manda em tudo: o bot só diz "vou te passar uma cotação agora"
// quando o código tem como cumprir — dados válidos E integração ligada. A
// frase é fixa, decidida aqui, nunca escrita pela IA. Prometer e não entregar
// é o defeito que o AdsGenius mais caça em si mesmo.
//
//   COTE_QUOTE_USER      a conta que recebe a cotação automática: o e-mail de
//                        login OU o id interno (tabela User) — o e-mail é o
//                        que se sabe de cabeça, o id exigiria abrir o banco
//   COTE_QUOTE_URL       https://<projeto>.supabase.co/functions/v1/cotacao-externa
//   COTE_QUOTE_KEY       a mesma chave configurada como COTACAO_EXTERNA_KEY no Cote+
//   COTE_QUOTE_OPERATOR  operadoras do leque padrão, separadas por vírgula
//                        (ex.: "samel,hapvida"; padrão "samel") — usadas quando
//                        o lead não disse preferência

export interface DadosDoLead {
  tipo: 'pf' | 'cnpj';
  idades: number[];
  /** Operadora que o lead disse preferir, se disse. */
  operadora?: string;
}

export interface IntegracaoCotacao {
  url: string;
  key: string;
  /** Leque padrão, quando o lead não pediu operadora. */
  operadoras: string[];
}

export interface CotacaoResultado {
  ok: boolean;
  texto?: string;
  avisos?: string[];
  planos?: unknown[];
  operadoras_encontradas?: string[];
  operadoras_nao_encontradas?: string[];
  error?: string;
}

export const REPLY_COTACAO_AGORA = 'Ótimo! Vou te passar uma cotação agora 😊';

export const REPLY_COTACAO_FALHOU =
  'Estou finalizando sua cotação — o consultor te envia em instantes por aqui mesmo. 🙏';

export const MAX_VIDAS = 12;

/** A integração está ligada para ESTA conta? Só a conta configurada —
 *  identificada pelo id interno ou pelo e-mail (sem caixa). */
export function resolverIntegracao(
  identidades: { userId: string; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): IntegracaoCotacao | null {
  const alvo = (env.COTE_QUOTE_USER ?? '').trim().toLowerCase();
  const url = (env.COTE_QUOTE_URL ?? '').trim();
  const key = (env.COTE_QUOTE_KEY ?? '').trim();
  if (!alvo || !url || !key) return null;
  const minhas = [identidades.userId, identidades.email ?? ''].map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!minhas.includes(alvo)) return null;
  const operadoras = (env.COTE_QUOTE_OPERATOR ?? 'samel')
    .split(',').map((o) => o.trim().toLowerCase()).filter(Boolean);
  return { url, key, operadoras: operadoras.length ? operadoras : ['samel'] };
}

// PURO. O que a IA devolveu em `dados` serve para cotar? Ela só ESTRUTURA o
// que o lead disse — mas pode inventar ou errar, então aqui valida como
// entrada externa: só pessoa física, idades inteiras plausíveis, quantidade
// coerente com o número de vidas quando os dois vierem.
export function extrairDadosParaCotacao(dados: unknown): DadosDoLead | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Record<string, unknown>;
  const tipo = String(d.tipo ?? '').toLowerCase();
  if (tipo !== 'pf' && tipo !== 'cnpj') return null;
  const idades = (Array.isArray(d.idades) ? d.idades : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 120);
  if (idades.length === 0 || idades.length > MAX_VIDAS) return null;
  const vidas = Number(d.vidas);
  if (Number.isInteger(vidas) && vidas > 0 && vidas !== idades.length) return null;
  // Operadora é texto do lead: curta, sem lixo. Vazia = sem preferência.
  const operadora = String(d.operadora ?? '').trim().slice(0, 40);
  return { tipo: tipo as 'pf' | 'cnpj', idades, ...(operadora ? { operadora } : {}) };
}

/** Cotação automática só para pessoa física; CNPJ tem negociação e vai ao corretor. */
export function podeCotarAutomaticamente(dados: DadosDoLead | null): dados is DadosDoLead {
  return dados !== null && dados.tipo === 'pf';
}

// I/O. Chama a porta do Cote+. Lança em falha de rede/HTTP; quem chama decide
// o fallback (e o fallback é sempre uma mensagem honesta ao lead).
export async function pedirCotacao(
  integracao: IntegracaoCotacao,
  dados: DadosDoLead,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; operadoras?: string[] } = {},
): Promise<CotacaoResultado> {
  const f = opts.fetchImpl ?? fetch;
  const operadoras = opts.operadoras ?? (dados.operadora ? [dados.operadora] : integracao.operadoras);
  const resp = await f(integracao.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-integration-key': integracao.key },
    body: JSON.stringify({
      idades: dados.idades,
      operadoras,
      modalidade: 'individual',
      coparticipacao: 'sem',
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  const body = (await resp.json().catch(() => ({}))) as CotacaoResultado;
  if (!resp.ok) throw new Error(`cotacao-externa ${resp.status}: ${body?.error ?? 'sem detalhe'}`);
  return body;
}

// O lead pediu uma operadora que o corretor não trabalha? Cota o leque
// padrão e diz isso ao lead, em vez de deixá-lo sem nada. Lançamentos de
// rede sobem para quem chama (fallback honesto está lá).
export async function cotarRespeitandoPreferencia(
  integracao: IntegracaoCotacao,
  dados: DadosDoLead,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CotacaoResultado> {
  const primeira = await pedirCotacao(integracao, dados, opts);
  const pediu = dados.operadora?.trim();
  if (!pediu || !primeira.ok || (primeira.planos?.length ?? 0) > 0) return primeira;

  const padrao = await pedirCotacao(integracao, dados, { ...opts, operadoras: integracao.operadoras });
  if (!padrao.ok || !padrao.texto) return padrao;
  return {
    ...padrao,
    texto: `Não trabalho com ${pediu} por aqui, mas estas são as opções que tenho:\n\n${padrao.texto}`,
    avisos: [`Lead pediu "${pediu}" (sem tabela); cotado o leque padrão`, ...(padrao.avisos ?? [])],
  };
}

// PURO. O que o vendedor recebe junto com o resumo: a cotação que o lead viu
// (para continuar de onde o bot parou) ou o motivo de não ter havido cotação
// (para cotar à mão na hora, sem perguntar as idades de novo).
export function montarNotaParaVendedor(
  dados: DadosDoLead | null,
  cotacao: CotacaoResultado | null,
  falha?: string,
): string {
  const idades = dados
    ? `Idades: ${dados.idades.join(', ')} (${dados.tipo.toUpperCase()})${dados.operadora ? ` · pediu ${dados.operadora}` : ''}`
    : 'Idades: não identificadas na conversa';
  if (cotacao?.ok && cotacao.texto) {
    const avisos = cotacao.avisos?.length ? `\n⚠️ ${cotacao.avisos.join(' · ')}` : '';
    return `${idades}\n✅ Cotação enviada ao lead:\n${cotacao.texto}${avisos}`;
  }
  if (cotacao?.ok && !cotacao.texto) {
    return `${idades}\n⚠️ Sem plano com tabela vigente para cotar — o lead ficou esperando a sua cotação.${cotacao.avisos?.length ? ` ${cotacao.avisos.join(' · ')}` : ''}`;
  }
  if (falha) return `${idades}\n⚠️ Cotação automática falhou (${falha}) — o lead ficou esperando a sua cotação.`;
  if (dados && dados.tipo === 'cnpj') return `${idades}\nℹ️ Empresarial: cotação fica com você.`;
  return idades;
}
