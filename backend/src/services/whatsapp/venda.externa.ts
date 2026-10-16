// A venda que o vendedor informou no WhatsApp, saindo deste backend para onde
// a venda da TELA de Vendas já ia: a tabela `closed_sales` no Supabase, a
// conversão "Venda — AdsGenius" no Google e o evento Purchase na Meta.
//
// Mesma tabela e mesmo formato de event_id da tela (`venda_<saleId>`): o
// agente mede lucro lendo `closed_sales`, não um lugar novo que só este fluxo
// conhece, e reenviar ESTA venda nunca conta duas vezes.
//
// ⚠️ O que isto NÃO evita: a mesma venda registrada aqui E depois digitada de
// novo na tela vira duas linhas (ids diferentes, dois eventos). Não há chave
// comum entre as duas portas. Por isso o aviso de novidades diz ao cliente que
// a venda informada pelo WhatsApp já entra na tela, sem registrar de novo.
//
// Nada aqui é fatal: falha de rede não pode derrubar o atendimento. Quem
// chama recebe o que subiu e o que não, e CONTA AO VENDEDOR — a regra do
// projeto é não dizer "sucesso" quando a plataforma recusou.

import prisma from '../../lib/prisma.js';
import { CapiService } from '../capi.service.js';
import { idDoEventoDaVenda } from './venda.id.js';
import { contaGoogleDoLead } from './conta.google.js';

export interface VendaParaRegistrar {
  userId: string;
  /** Conversa do lead — dá o event_id da Meta quando não há linha na tela. */
  convId: string;
  /** Telefone do lead (comprador). */
  telefone: string;
  valorCents: number;
  /** Nome do lead, quando o WhatsApp informou. */
  nome?: string | null;
  /** Campanha do Google que trouxe o lead, quando a origem é Google. */
  campanhaGoogleId?: string | null;
  /** gclid/gbraid/wbraid do clique do site, quando houver. */
  clique?: { gclid?: string; gbraid?: string; wbraid?: string };
  /** Click id do anúncio CTWA da Meta, quando o lead veio de um. */
  ctwaClid?: string | null;
}

export type SituacaoNaPlataforma = 'enviada' | 'falhou' | 'nao_conectada';

export interface ResultadoDoRegistro {
  /**
   * A venda na TELA de Vendas (`closed_sales`):
   *   • 'gravada'   — está lá;
   *   • 'sem_conta' — não há onde gravar (sem conta Google conectada, sem SSO):
   *                   não adianta tentar de novo;
   *   • 'falhou'    — falha passageira (rede, recusa do banco): o chamador
   *                   destrava o lead para o vendedor mandar de novo.
   */
  tela: 'gravada' | 'sem_conta' | 'falhou';
  saleId: string | null;
  google: SituacaoNaPlataforma;
  meta: SituacaoNaPlataforma;
  /** Motivo curto para o aviso — nunca o erro cru. */
  detalhe?: string;
}

/** Data de hoje em Manaus ("AAAA-MM-DD") — é o fuso do cliente, e closed_at
 *  é DATE: usar UTC marcaria a venda da noite no dia seguinte. */
export function hojeEmManaus(agora = new Date()): string {
  return new Date(agora.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** event_id da Meta quando a venda NÃO tem linha na tela (cliente só-Meta).
 *  Estável por conversa: o lead só vende uma vez, e reenvio não duplica. */
export const idDoEventoSemTela = (convId: string) => `venda_conv_${convId}`;

function supabaseConfig(): { base: string; key: string } | null {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base && key ? { base, key } : null;
}

/** Cabeçalhos do REST do Supabase. A chave NUNCA é logada (ver CLAUDE.md). */
function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Onde a venda pode morar na tela: a conta do ANÚNCIO que trouxe o lead (ou a
 * ativa, com aviso — ver conta.google.ts), ou o porquê de não haver.
 *
 * ⚠️ Sem fallback para GOOGLE_ADS_CUSTOMER_ID: esse padrão já fez campanha de
 * cliente nascer dentro da conta do fundador.
 */
async function destinoNaTela(
  userId: string,
  campanhaGoogleId: string | null,
): Promise<{ cfg: { base: string; key: string }; supabaseUserId: string; customerId: string } | { semConta: string }> {
  const cfg = supabaseConfig();
  if (!cfg) return { semConta: 'AdsGenius não configurado neste servidor' };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { supabaseUserId: true } });
  if (!user?.supabaseUserId) return { semConta: 'conta sem login unificado do AdsGenius' };
  const conta = await contaGoogleDoLead(cfg.base, cfg.key, user.supabaseUserId, campanhaGoogleId);
  if (!conta.customerId) return { semConta: 'nenhuma conta Google Ads conectada' };
  if (conta.aviso) {
    console.warn(`[venda:vendedor] ⚠️ conta ATIVA ${conta.customerId} usada para a venda — ${conta.aviso}. Se o lead veio de outra conta, o Google não vai casar.`);
  }
  const customerId = conta.customerId;
  return { cfg, supabaseUserId: user.supabaseUserId, customerId };
}

/**
 * Grava a venda em `closed_sales` e sobe a conversão às duas plataformas.
 *
 * A ordem importa: sem a linha em `closed_sales` não existe `saleId`, e sem
 * `saleId` o Google não tem como deduplicar — então o Google só recebe venda
 * gravada. A Meta é diferente: cliente que só anuncia na Meta (o público do
 * clique-para-WhatsApp) não tem conta Google e por isso não tem linha na tela,
 * mas a venda dele tem de chegar à Meta — com um id estável da conversa.
 */
export async function registrarVendaNasPlataformas(v: VendaParaRegistrar): Promise<ResultadoDoRegistro> {
  let destino: Awaited<ReturnType<typeof destinoNaTela>>;
  try {
    destino = await destinoNaTela(v.userId, v.campanhaGoogleId ?? null);
  } catch (e) {
    console.error('[venda:vendedor] falha ao ler a conexão do cliente:', e instanceof Error ? e.message : 'erro');
    return { tela: 'falhou', saleId: null, google: 'falhou', meta: 'falhou', detalhe: 'o AdsGenius não respondeu' };
  }

  if ('semConta' in destino) {
    const meta = await enviarAMeta(v, idDoEventoSemTela(v.convId));
    return { tela: 'sem_conta', saleId: null, google: 'nao_conectada', meta, detalhe: destino.semConta };
  }

  let saleId: string | null = null;
  try {
    const resp = await fetch(`${destino.cfg.base}/rest/v1/closed_sales`, {
      method: 'POST',
      headers: { ...headers(destino.cfg.key), Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: destino.supabaseUserId,
        customer_id: destino.customerId,
        // Só campanha do GOOGLE entra aqui: closed_sales.campaign_id é lido
        // pela medição de lucro por campanha do Google. Id de campanha da
        // Meta neste campo viraria receita atribuída a uma campanha que não
        // existe naquela conta.
        campaign_id: v.campanhaGoogleId ?? null,
        client_name: v.nome?.trim() || null,
        amount_brl: (v.valorCents / 100).toFixed(2),
        closed_at: hojeEmManaus(),
      }),
    });
    if (resp.ok) {
      const linhas = (await resp.json().catch(() => [])) as Array<{ id?: string }>;
      saleId = linhas[0]?.id ?? null;
    } else {
      console.error(`[venda:vendedor] closed_sales recusou a venda (HTTP ${resp.status})`);
    }
  } catch (e) {
    console.error('[venda:vendedor] falha ao gravar em closed_sales:', e instanceof Error ? e.message : 'erro');
  }
  if (!saleId) {
    // Nada subiu: com a linha ausente, a venda tem de poder ser mandada de
    // novo — quem chama destrava o lead e pede ao vendedor para repetir.
    return { tela: 'falhou', saleId: null, google: 'falhou', meta: 'falhou', detalhe: 'o AdsGenius não gravou a venda' };
  }

  const [google, meta] = await Promise.all([
    enviarAoGoogle(destino.cfg.base, destino.cfg.key, destino.supabaseUserId, saleId, v),
    enviarAMeta(v, idDoEventoDaVenda(saleId)),
  ]);
  return { tela: 'gravada', saleId, google, meta };
}

async function enviarAoGoogle(
  base: string, key: string, supabaseUserId: string, saleId: string, v: VendaParaRegistrar,
): Promise<'enviada' | 'falhou'> {
  try {
    const resp = await fetch(`${base}/functions/v1/upload-sale-conversion`, {
      method: 'POST',
      headers: headers(key),
      // user_id no corpo porque a chamada é server-to-server (não há JWT de
      // usuário): a function valida a service role e confere que a venda é
      // deste user_id. Valor e data ela lê de closed_sales, nunca do corpo.
      body: JSON.stringify({ user_id: supabaseUserId, sale_id: saleId, phone: v.telefone, ...(v.clique ?? {}) }),
    });
    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (data?.ok) {
      console.log(`[venda:vendedor] venda ${saleId} enviada ao Google${v.clique?.gclid ? ' com o clique do anúncio' : ''}`);
      return 'enviada';
    }
    console.warn(`[venda:vendedor] Google recusou a venda ${saleId}:`, data?.error ?? resp.status);
    return 'falhou';
  } catch (e) {
    console.error('[venda:vendedor] erro ao enviar a venda ao Google:', e instanceof Error ? e.message : 'erro');
    return 'falhou';
  }
}

async function enviarAMeta(v: VendaParaRegistrar, eventId: string): Promise<SituacaoNaPlataforma> {
  try {
    // Cliente que não usa Meta não é "falha" — é "não conectada", como na
    // tela. Senão todo cliente só-Google receberia aviso de erro a cada venda.
    const conectada = await prisma.mCPConnection.findUnique({ where: { userId: v.userId }, select: { id: true } });
    if (!conectada) return 'nao_conectada';
    const res = await new CapiService(v.userId).sendPurchase({
      phone: v.telefone,
      eventId,
      value: v.valorCents / 100,
      ctwaClid: v.ctwaClid ?? null,
    });
    if (res.ok) {
      console.log(`[venda:vendedor] venda ${eventId} enviada à Meta${v.ctwaClid ? ' com o clique do anúncio' : ''}`);
      return 'enviada';
    }
    console.warn(`[venda:vendedor] Meta recusou a venda ${eventId}: ${res.error}`);
    return 'falhou';
  } catch (e) {
    console.error('[venda:vendedor] erro ao enviar a venda à Meta:', e instanceof Error ? e.message : 'erro');
    return 'falhou';
  }
}
