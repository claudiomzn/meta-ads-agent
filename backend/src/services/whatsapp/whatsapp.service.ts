// Orquestrador da qualificação de leads via WhatsApp (agnóstico de transporte).
// Fluxo: mensagem recebida → carrega config + conversa → IA gera resposta →
// envia pelo transporte → dispara conversão (1ª msg) → handoff se qualificado.

import prisma from '../../lib/prisma.js';
import { resolveTransport, type InboundMessage } from './transport.js';
import { nextReply, type QualConfig, type QualTurn } from './qualification.service.js';

interface HistoryItem { role: 'user' | 'assistant'; text: string; at: string }

export class WhatsappService {
  constructor(private userId: string) {}

  // ── Config ────────────────────────────────────────────────────────────────
  async getConfig() {
    return prisma.whatsappConfig.findUnique({ where: { userId: this.userId } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsertConfig(data: Record<string, any>) {
    const base = {
      businessName: data.businessName ?? 'Meu Negócio',
      product: data.product ?? '',
      differentials: data.differentials ?? null,
      region: data.region ?? null,
      tone: data.tone ?? 'amigável e profissional',
      questions: data.questions ?? [],
      qualifiedCriteria: data.qualifiedCriteria ?? 'Respondeu às perguntas de qualificação',
      maxQuestions: data.maxQuestions ?? 4,
      maxBotMessages: data.maxBotMessages ?? 8,
      handoffContact: data.handoffContact ?? null,
      businessHours: data.businessHours ?? null,
      transport: data.transport ?? 'none',
      transportConfig: data.transportConfig ?? {},
      conversionId: data.conversionId ?? null,
      conversionLabel: data.conversionLabel ?? null,
      enabled: data.enabled ?? false,
    };
    return prisma.whatsappConfig.upsert({
      where: { userId: this.userId },
      create: { userId: this.userId, ...base },
      update: base,
    });
  }

  // ── Processamento de mensagem recebida ──────────────────────────────────────
  // Retorna a resposta enviada (ou null se o bot estiver desligado/sem config).
  async handleInbound(msg: InboundMessage): Promise<{ reply: string; state: string } | null> {
    const config = await this.getConfig();
    if (!config || !config.enabled) return null;

    // Carrega ou cria a conversa deste lead
    let conv = await prisma.whatsappConversation.findUnique({
      where: { userId_leadPhone: { userId: this.userId, leadPhone: msg.from } },
    });
    if (!conv) {
      conv = await prisma.whatsappConversation.create({
        data: { userId: this.userId, leadPhone: msg.from, state: 'greeting' },
      });
    }
    if (conv.state === 'closed' || conv.state === 'handoff') {
      // Já encaminhado/encerrado — não responde mais (humano assume).
      return null;
    }

    const history = (conv.history as unknown as HistoryItem[]) ?? [];
    history.push({ role: 'user', text: msg.text, at: new Date().toISOString() });

    const cfg: QualConfig = {
      businessName: config.businessName,
      product: config.product,
      differentials: config.differentials,
      region: config.region,
      tone: config.tone,
      questions: (config.questions as unknown as string[]) ?? [],
      qualifiedCriteria: config.qualifiedCriteria,
      maxQuestions: config.maxQuestions,
      maxBotMessages: config.maxBotMessages,
      businessHours: config.businessHours,
    };

    const turns: QualTurn[] = history.map((h) => ({ role: h.role, text: h.text }));
    const result = await nextReply(cfg, turns, conv.questionsAsked, conv.botMessages);

    // Envia a resposta pelo transporte configurado
    const transport = resolveTransport(config.transport, config.transportConfig as Record<string, unknown>);
    await transport.sendText(msg.from, result.reply);

    history.push({ role: 'assistant', text: result.reply, at: new Date().toISOString() });

    // Dispara conversão na PRIMEIRA resposta (clique→conversa = lead via WhatsApp)
    const shouldFireConversion = !conv.conversionFired;
    if (shouldFireConversion) {
      await this.fireConversion(config.conversionId, config.conversionLabel, msg.from);
    }

    // Handoff: avisa o vendedor com o resumo
    if (result.done && result.state === 'handoff' && config.handoffContact) {
      await this.notifyVendor(config.handoffContact, msg.from, result.summary ?? '', transport);
    }

    await prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: {
        state: result.state,
        label: result.label ?? conv.label,
        questionsAsked: conv.questionsAsked + (result.state === 'qualifying' ? 1 : 0),
        botMessages: conv.botMessages + 1,
        history: history as unknown as object,
        summary: result.summary ?? conv.summary,
        conversionFired: conv.conversionFired || shouldFireConversion,
      },
    });

    return { reply: result.reply, state: result.state };
  }

  // Dispara a conversão. Por enquanto registra; o envio real ao Google Ads
  // (conversão offline/click) entra quando ligarmos a ponte com a conta.
  private async fireConversion(conversionId: string | null, label: string | null, lead: string) {
    if (!conversionId || !label) {
      console.log(`[whatsapp] conversão não configurada p/ lead ${lead} — pulando disparo`);
      return;
    }
    // TODO: enviar Click/Enhanced Conversion ao Google Ads (precisa do gclid do lead).
    console.log(`[whatsapp] conversão disparada: ${conversionId}/${label} (lead ${lead})`);
  }

  private async notifyVendor(
    contact: string,
    lead: string,
    summary: string,
    transport: ReturnType<typeof resolveTransport>,
  ) {
    const text = `🔔 Novo lead qualificado!\nContato: ${lead}\n${summary}`;
    await transport.sendText(contact, text).catch((e) =>
      console.error('[whatsapp] falha ao notificar vendedor:', e),
    );
  }
}
