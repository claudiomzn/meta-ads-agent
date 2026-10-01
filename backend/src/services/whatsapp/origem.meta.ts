// Descobre a CAMPANHA de um anúncio "clique para o WhatsApp" (CTWA) na Meta.
//
// O referral do anúncio traz só o ID do anúncio (sourceId). Para contar leads
// e QUENTES por campanha, o app precisa da campanha — que a Graph API dá com
// `ads_read`, a única permissão aprovada do app Meta hoje.
//
// Nunca lança: falha aqui não pode atrapalhar o atendimento. Também nunca
// grava o que não conferiu — resposta sem campaign_id numérico = null.

import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { decrypt } from '../crypto.service.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export async function resolverCampanhaDoAnuncio(userId: string, anuncioId: string): Promise<string | null> {
  // O ID vem do payload do webhook (externo): só número, antes de virar URL.
  if (!/^\d{6,25}$/.test(anuncioId)) return null;
  try {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId } });
    if (!conn) return null;
    const res = await axios.get(`${GRAPH}/${anuncioId}`, {
      params: { fields: 'campaign_id', access_token: decrypt(conn.metaAccessToken) },
      timeout: 8000,
    });
    const id = String(res.data?.campaign_id ?? '');
    return /^\d+$/.test(id) ? id : null;
  } catch (e) {
    // Só status e mensagem da Meta — nunca o erro cru, que carrega a URL com
    // o access_token nos params (CLAUDE.md: o log do Render já vazou token).
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: { message?: string } })?.error?.message : (e as Error).message;
    console.warn(`[whatsapp:origem] campanha do anúncio ${anuncioId} não resolvida (${status ?? 'sem status'}): ${msg ?? ''}`);
    return null;
  }
}
