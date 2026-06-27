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

// Resolve o transporte a partir da config do cliente.
// Por enquanto só "log"; "evolution" e "meta" entram quando plugarmos.
export function resolveTransport(
  transport: string,
  _config: Record<string, unknown>,
): WhatsappTransport {
  switch (transport) {
    // case 'evolution': return new EvolutionTransport(_config);
    // case 'meta':      return new MetaWhatsappTransport(_config);
    default:
      return new LogTransport();
  }
}
