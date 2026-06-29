// Transporte agnóstico de WhatsApp.
// O miolo da qualificação (estado + IA + config) NÃO conhece o transporte.
// Ele só chama transport.sendText(...). Plugamos Evolution OU Meta oficial depois.

export interface InboundMessage {
  /** Número/id do lead que enviou a mensagem (E.164 ou jid do WhatsApp). */
  from: string;
  /** Texto recebido. */
  text: string;
  /** Identificador do transporte de origem (debug). */
  transport: string;
  /**
   * Click id de clique-para-WhatsApp (CTWA), quando o lead chegou por um
   * anúncio Meta. Melhora muito a atribuição do evento CAPI. O transporte
   * oficial do Meta preenche; transportes sem esse dado deixam indefinido.
   */
  ctwaClid?: string | null;
}

export interface WhatsappTransport {
  /** Nome do transporte ("evolution" | "meta" | "log"). */
  readonly name: string;
  /** Envia uma mensagem de texto para o lead. */
  sendText(to: string, text: string): Promise<void>;
  /**
   * Converte o payload bruto do webhook do provedor numa InboundMessage
   * normalizada — ou null se o evento não for uma mensagem de texto de lead
   * (status, ack, mensagem do próprio número, grupo, etc.).
   */
  parseInbound(payload: unknown): InboundMessage | null;
}

// ── Transporte LOG (default, sem infra) ──────────────────────────────────────
// Não envia nada de verdade — só registra. Permite desenvolver e testar o miolo
// de qualificação ponta-a-ponta antes de plugar Evolution ou Meta.
export class LogTransport implements WhatsappTransport {
  readonly name = 'log';

  async sendText(to: string, text: string): Promise<void> {
    console.log(`[whatsapp:log] → ${to}: ${text}`);
  }

  // Aceita um formato simples para testes manuais: { from, text }
  parseInbound(payload: unknown): InboundMessage | null {
    const p = payload as { from?: string; text?: string } | null;
    if (!p?.from || !p?.text) return null;
    return { from: String(p.from), text: String(p.text), transport: this.name };
  }
}

// ── Transporte EVOLUTION API ──────────────────────────────────────────────────
// Envia/recebe mensagens via uma instância self-hosted da Evolution API
// (https://doc.evolution-api.com). Config esperada (transportConfig):
//   { baseUrl: "https://sua-evolution.com", apiKey: "...", instance: "nome" }
export class EvolutionTransport implements WhatsappTransport {
  readonly name = 'evolution';

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private instance: string,
  ) {}

  // Não-fatal: falha no envio não pode derrubar o fluxo de qualificação.
  async sendText(to: string, text: string): Promise<void> {
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/message/sendText/${this.instance}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
        body: JSON.stringify({ number: to, text }),
      });
      if (!resp.ok) {
        console.error(`[whatsapp:evolution] sendText falhou (${resp.status}):`, await resp.text());
      }
    } catch (e) {
      console.error('[whatsapp:evolution] erro inesperado no sendText:', e);
    }
  }

  // Webhook da Evolution API v2: { event: "messages.upsert", instance, data }
  // onde `data` é o objeto da mensagem — { key: { remoteJid, fromMe, id }, message: {...} }
  // (em algumas versões `data` vem como array; tratamos os dois casos).
  parseInbound(payload: unknown): InboundMessage | null {
    const body = payload as { event?: string; data?: unknown } | null;
    if (!body) return null;
    if (body.event && body.event !== 'messages.upsert') return null;

    const raw = Array.isArray(body.data) ? body.data[0] : body.data;
    const data = raw as {
      key?: { remoteJid?: string; fromMe?: boolean };
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
    } | undefined;
    if (!data?.key?.remoteJid) return null;

    // Ignora mensagens enviadas por nós mesmos (eco do próprio bot).
    if (data.key.fromMe) return null;

    // Ignora mensagens de grupo (jid termina em @g.us; contatos terminam em @s.whatsapp.net).
    if (data.key.remoteJid.endsWith('@g.us')) return null;

    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
    if (!text) return null; // status, ack, reação, mídia sem legenda, etc. — não é lead falando

    const from = data.key.remoteJid.replace('@s.whatsapp.net', '');
    return { from, text, transport: this.name };
  }
}

// Resolve o transporte a partir da config do cliente.
export function resolveTransport(
  transport: string,
  config: Record<string, unknown>,
): WhatsappTransport {
  switch (transport) {
    case 'evolution': {
      const baseUrl = config.baseUrl as string | undefined;
      const apiKey = config.apiKey as string | undefined;
      const instance = config.instance as string | undefined;
      if (!baseUrl || !apiKey || !instance) {
        console.warn('[whatsapp] transport "evolution" sem baseUrl/apiKey/instance — usando LogTransport');
        return new LogTransport();
      }
      return new EvolutionTransport(baseUrl, apiKey, instance);
    }
    // case 'meta': return new MetaWhatsappTransport(config);
    default:
      return new LogTransport();
  }
}
