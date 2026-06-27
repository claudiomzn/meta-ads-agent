// Conversions API (CAPI) — envio de eventos server-side ao Meta.
// Recupera o sinal de conversão que o Pixel sozinho perde (iOS, bloqueio de
// cookies). O 1º uso é o evento "Lead" disparado quando o bot de WhatsApp
// qualifica um lead (QUENTE) — assim o Meta otimiza para leads de QUALIDADE,
// não só volume de cliques.

import prisma from '../lib/prisma.js';
import axios from 'axios';
import crypto from 'crypto';

import { decrypt } from './crypto.service.js';
import { PixelService } from './pixel.service.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// Normaliza telefone para o padrão do Meta antes do hash: só dígitos, com
// código do país (assume Brasil/55 quando vier sem). Ex.: "(92) 99999-9999"
// → "5592999999999".
function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return d;
}

export interface LeadEventInput {
  /** Telefone do lead (qualquer formato — é normalizado e hasheado). */
  phone: string;
  /** ID estável do evento p/ deduplicar com o Pixel (ex.: "lead_<convId>"). */
  eventId: string;
  /** Click id de clique-para-WhatsApp, quando o lead veio de um anúncio CTWA. */
  ctwaClid?: string | null;
  /** Valor da conversão (opcional). */
  value?: number;
  currency?: string;
  /** Código de teste — aparece em "Test Events" no Gerenciador de Eventos. */
  testEventCode?: string;
}

export interface CapiStatus {
  ready: boolean;
  pixelId: string | null;
  reason?: string;
}

export class CapiService {
  constructor(private userId: string) {}

  private async getToken(): Promise<string> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn) throw new Error('Conta Meta não conectada.');
    if (conn.mcpProvider === 'pipeboard' || conn.mcpProvider === 'zapier') {
      const envToken = process.env.META_ACCESS_TOKEN;
      if (!envToken) throw new Error('META_ACCESS_TOKEN não configurado.');
      return envToken;
    }
    return decrypt(conn.metaAccessToken);
  }

  // Garante um pixelId (reusa o salvo; se faltar, busca/cria via PixelService).
  private async resolvePixelId(): Promise<string> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (conn?.metaPixelId) return conn.metaPixelId;
    const status = await new PixelService(this.userId).createOrGetPixel();
    if (!status.pixelId) throw new Error('Não foi possível resolver o Pixel da conta.');
    return status.pixelId;
  }

  async getStatus(): Promise<CapiStatus> {
    try {
      const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
      if (!conn) return { ready: false, pixelId: null, reason: 'Conta Meta não conectada.' };
      return { ready: Boolean(conn.metaPixelId), pixelId: conn.metaPixelId ?? null,
        reason: conn.metaPixelId ? undefined : 'Pixel ainda não criado — crie o Pixel para ativar o CAPI.' };
    } catch (e) {
      return { ready: false, pixelId: null, reason: (e as Error).message };
    }
  }

  /**
   * Envia um evento "Lead" via CAPI. Não lança — devolve {ok,...} para que o
   * fluxo de WhatsApp nunca quebre por causa do rastreamento.
   */
  async sendLead(input: LeadEventInput): Promise<{ ok: boolean; error?: string; eventsReceived?: number }> {
    try {
      const token = await this.getToken();
      const pixelId = await this.resolvePixelId();

      const phone = normalizePhone(input.phone);
      // Sem ctwa_clid não há contexto de navegador; "business_messaging" é a
      // origem correta p/ conversões vindas de mensageria (WhatsApp).
      const action_source = input.ctwaClid ? 'business_messaging' : 'system_generated';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userData: Record<string, any> = {};
      if (phone) userData.ph = [sha256(phone)];
      if (input.ctwaClid) userData.ctwa_clid = input.ctwaClid;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event: Record<string, any> = {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId, // deduplicação com o Pixel
        action_source,
        user_data: userData,
      };
      if (action_source === 'business_messaging') event.messaging_channel = 'whatsapp';
      if (input.value != null) {
        event.custom_data = { value: input.value, currency: input.currency ?? 'BRL' };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { data: [event] };
      if (input.testEventCode) body.test_event_code = input.testEventCode;

      const res = await axios.post(`${GRAPH}/${pixelId}/events`, body, {
        params: { access_token: token },
      });
      return { ok: true, eventsReceived: res.data?.events_received };
    } catch (e) {
      const err = axios.isAxiosError(e)
        ? JSON.stringify(e.response?.data ?? e.message)
        : (e as Error).message;
      console.error('[capi] falha ao enviar Lead:', err);
      return { ok: false, error: err };
    }
  }
}
