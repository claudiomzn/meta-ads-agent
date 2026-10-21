// Transporte agnóstico de WhatsApp.
// O miolo da qualificação (estado + IA + config) NÃO conhece o transporte.
// Ele só chama transport.sendText(...). Plugamos Evolution OU Meta oficial depois.

import { extrairDadosDoAnuncio, pareceAnuncio, type DadosDoAnuncio } from './origem.js';

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
  /** Referral do anúncio CTWA (só vem na 1ª mensagem de quem clicou no anúncio). */
  anuncio?: DadosDoAnuncio | null;
  /**
   * Ensaio do simulador do painel (05/10/2026): o fluxo roda inteiro, mas nada
   * sai daqui — nenhuma mensagem enviada a ninguém, nenhuma conversão, nada de
   * franquia/saldo. O aviso ao vendedor volta na resposta, marcado como TESTE.
   */
  ensaio?: boolean;
  /**
   * Veio do simulador do painel, que faz o papel de um lead de anúncio. Sem
   * gatilho configurado, só ele (além de anúncio/código do site) abre conversa
   * — ver podeAbrirConversa.
   */
  simulado?: boolean;
  /**
   * Texto da mensagem CITADA (o "responder" do WhatsApp), quando houver
   * (12/10/2026). É o que diz a QUAL lead o vendedor está respondendo: ele
   * cita o próprio aviso "🔔 Novo lead qualificado! Contato: …" e o app lê o
   * número de lá, em vez de adivinhar — ver resultado.ts.
   */
  citacao?: string | null;
  /**
   * Nome que o WhatsApp mostra para quem enviou (pushName). Serve para o
   * vendedor reconhecer o lead no aviso e no lembrete ("Lead João"), e não
   * substitui nada do que o roteiro coletou.
   */
  nomeDoContato?: string | null;
  /** Id da mensagem no WhatsApp (key.id) — para não contar a própria mensagem
   *  como "conversa anterior" ao consultar o histórico do número. */
  mensagemId?: string | null;
  /** Quando o lead ENVIOU a mensagem (ms), segundo o WhatsApp. Mensagem antiga
   *  reentregue na reconexão não é lead chegando agora. */
  enviadaEm?: number | null;
  /**
   * Mensagem ENVIADA por este WhatsApp (key.fromMe), não recebida (21/10/2026).
   * Ou é o eco do próprio robô, ou é a atendente digitando no celular da
   * empresa — e aí uma pessoa assumiu a conversa e o robô tem de sair. Quem
   * separa um caso do outro é o serviço (ver tratarMensagemDaEquipe).
   */
  fromMe?: boolean;
}

/** Prefixo do leadPhone das conversas de ensaio: isola do número real e deixa
 *  fácil excluir de franquia, relatório e busca de venda. */
export const PREFIXO_ENSAIO = 'teste:';

// ── Mensagens que o PRÓPRIO robô enviou (21/10/2026) ─────────────────────────
// A Evolution devolve o key.id de cada envio e depois reentrega a mesma
// mensagem no webhook como fromMe. Guardar o id é o que separa o eco do robô
// da resposta que a atendente digitou no celular. Em memória, por processo
// (mesma premissa do withLeadLock): depois de um restart o serviço ainda
// reconhece o eco pelo texto gravado no histórico da conversa.
const ENVIADAS_PELO_ROBO_TTL_MS = 6 * 60 * 60 * 1000;
const enviadasPeloRobo = new Map<string, number>();

export function registrarEnvioDoRobo(id: string, agora = Date.now()): void {
  enviadasPeloRobo.set(id, agora);
  // Saída do "estado de espera": nada fica aqui para sempre.
  for (const [k, em] of enviadasPeloRobo) {
    if (agora - em > ENVIADAS_PELO_ROBO_TTL_MS) enviadasPeloRobo.delete(k);
  }
}

export function foiEnviadaPeloRobo(id: string | null | undefined): boolean {
  return Boolean(id) && enviadasPeloRobo.has(id as string);
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

  // Aceita um formato simples para testes manuais: { from, text, citacao? }
  parseInbound(payload: unknown): InboundMessage | null {
    const p = payload as { from?: string; text?: string; citacao?: string; pushName?: string } | null;
    if (!p?.from || !p?.text) return null;
    return {
      from: String(p.from), text: String(p.text), transport: this.name,
      citacao: p.citacao ? String(p.citacao) : null,
      nomeDoContato: p.pushName ? String(p.pushName) : null,
    };
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
        return;
      }
      // O id do envio marca a mensagem como do robô: quando ela voltar no
      // webhook como fromMe, não pode ser confundida com a atendente.
      const corpo = await resp.json().catch(() => null) as { key?: { id?: unknown } } | null;
      if (typeof corpo?.key?.id === 'string') registrarEnvioDoRobo(corpo.key.id);
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

    // Diagnóstico: se `data` vier como array com mais de 1 item, hoje só o
    // primeiro é usado — se não for a mensagem certa, o texto extraído é
    // silenciosamente o errado. Logar o tamanho ajuda a confirmar/descartar isso.
    if (Array.isArray(body.data) && body.data.length > 1) {
      console.warn(`[whatsapp:evolution] webhook com data[] de ${body.data.length} itens — usando só o índice 0`);
    }
    const raw = Array.isArray(body.data) ? body.data[0] : body.data;
    const data = raw as {
      key?: { remoteJid?: string; fromMe?: boolean; id?: string };
      messageTimestamp?: unknown;
      pushName?: string;
      message?: {
        conversation?: string;
        extendedTextMessage?: {
          text?: string;
          contextInfo?: {
            quotedMessage?: { conversation?: string; extendedTextMessage?: { text?: string } };
          };
        };
      };
    } | undefined;
    if (!data?.key?.remoteJid) return null;

    // Ignora mensagens de grupo (jid termina em @g.us; contatos terminam em @s.whatsapp.net).
    if (data.key.remoteJid.endsWith('@g.us')) return null;

    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
    const from = data.key.remoteJid.replace('@s.whatsapp.net', '');

    // Mensagem ENVIADA por este número. Até 21/10/2026 era descartada aqui
    // como "eco do próprio bot" — mas a resposta que a atendente digita no
    // celular da empresa também é fromMe, e o robô nunca soube que uma pessoa
    // tinha assumido: seguia mandando o roteiro no meio da conversa dela. Agora
    // sobe ao serviço, que separa eco do robô de gente. Áudio/foto da atendente
    // também contam (texto vazio): quem mandou foi uma pessoa.
    if (data.key.fromMe) {
      return {
        from, text: text ?? '', transport: this.name, fromMe: true,
        mensagemId: data.key.id ?? null,
        enviadaEm: momentoDoWhatsapp(data.messageTimestamp),
      };
    }

    if (!text) return null; // status, ack, reação, mídia sem legenda, etc. — não é lead falando

    // Referral do anúncio "clique para o WhatsApp". Até 01/10/2026 ninguém lia
    // isto — o ctwaClid do tipo acima ficava sempre vazio.
    const anuncio = extrairDadosDoAnuncio(body);
    if (!anuncio && pareceAnuncio(body)) {
      // Formato ainda não confirmado com mensagem real: registra a FORMA (só
      // chaves, nada do lead) para ajustar a leitura sem adivinhar campo.
      console.warn('[whatsapp:origem] mensagem com cara de anúncio sem ctwaClid/sourceId reconhecível — chaves:',
        JSON.stringify(Object.keys((raw ?? {}) as object)), JSON.stringify(Object.keys((data.message ?? {}) as object)));
    }
    // Mensagem citada ("responder"): só o TEXTO interessa — é dele que sai o
    // "Contato: …" do nosso próprio aviso ao vendedor.
    const citada = data.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const citacao = citada?.conversation ?? citada?.extendedTextMessage?.text ?? null;

    return {
      from, text, transport: this.name,
      ctwaClid: anuncio?.ctwaClid ?? null, anuncio,
      citacao,
      nomeDoContato: typeof data.pushName === 'string' && data.pushName.trim() ? data.pushName.trim() : null,
      mensagemId: data.key.id ?? null,
      enviadaEm: momentoDoWhatsapp(data.messageTimestamp),
    };
  }
}

// Resolve o transporte a partir da config do cliente.
// Para "evolution", baseUrl/apiKey caem para a Evolution CENTRAL do AdsGenius
// (env EVOLUTION_URL/EVOLUTION_API_KEY) quando não vierem na config — é o modo
// gerenciado, onde o cliente só escaneia o QR e a config guarda só a instância.
export function resolveTransport(
  transport: string,
  config: Record<string, unknown>,
): WhatsappTransport {
  switch (transport) {
    case 'evolution': {
      const baseUrl = (config.baseUrl as string | undefined) || process.env.EVOLUTION_URL;
      const apiKey = (config.apiKey as string | undefined) || process.env.EVOLUTION_API_KEY;
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

/**
 * `messageTimestamp` do WhatsApp em ms. Vem em SEGUNDOS, e conforme a versão da
 * Evolution como número, texto ou Long do protobuf ({ low, high }). Formato
 * desconhecido → null (quem chama trata como "não dá para saber").
 */
export function momentoDoWhatsapp(v: unknown): number | null {
  let seg: number | null = null;
  if (typeof v === 'number') seg = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) seg = Number(v);
  else if (v && typeof v === 'object' && typeof (v as { low?: unknown }).low === 'number') {
    const { low, high } = v as { low: number; high?: number };
    seg = (high ?? 0) * 2 ** 32 + (low >>> 0);
  }
  if (seg == null || !Number.isFinite(seg)) return null;
  const ms = seg > 1e11 ? seg : seg * 1000; // já veio em ms? não multiplica de novo
  // Antes de 2020: não é um carimbo de verdade.
  return ms < 1_577_836_800_000 ? null : ms;
}
