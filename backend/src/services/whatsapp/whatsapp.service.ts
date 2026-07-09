// Orquestrador da qualificação de leads via WhatsApp (agnóstico de transporte).
// Fluxo: mensagem recebida → carrega config + conversa → IA gera resposta →
// envia pelo transporte → dispara conversão (1ª msg) → handoff se qualificado.

import prisma from '../../lib/prisma.js';
import { resolveTransport, type InboundMessage } from './transport.js';
import { nextReply, type QualConfig, type QualTurn } from './qualification.service.js';
import { CapiService } from '../capi.service.js';
import { sendMail } from '../email.service.js';
import { asaasConfigured, ensureAsaasCustomer, createOverageCharge } from '../asaas.service.js';

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
      billingCpfCnpj: data.billingCpfCnpj ?? null,
    };
    return prisma.whatsappConfig.upsert({
      where: { userId: this.userId },
      create: { userId: this.userId, ...base },
      update: base,
    });
  }

  // ── Uso/cobrança (para o painel do cliente) ─────────────────────────────────
  async getUsageStatus() {
    const config = await this.getConfig();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const [todayCount, lastCharges] = await Promise.all([
      prisma.whatsappConversation.count({ where: { userId: this.userId, createdAt: { gte: startOfToday } } }),
      prisma.whatsappCharge.findMany({ where: { userId: this.userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    return {
      dailyFreeConversations: config?.dailyFreeConversations ?? 12,
      dailyOverageCentsPerMsg: config?.dailyOverageCentsPerMsg ?? 15,
      overageChargeThresholdCents: config?.overageChargeThresholdCents ?? 2000,
      pendingOverageCents: config?.pendingOverageCents ?? 0,
      todayConversations: todayCount,
      billingCpfCnpj: config?.billingCpfCnpj ?? null,
      charges: lastCharges,
    };
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
      // Limite diário: as primeiras N conversas NOVAS do dia são grátis; a
      // partir da (N+1)ª, toda mensagem do bot nesta conversa é cobrada.
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const todayCount = await prisma.whatsappConversation.count({
        where: { userId: this.userId, createdAt: { gte: startOfToday } },
      });
      const billable = todayCount >= config.dailyFreeConversations;
      conv = await prisma.whatsappConversation.create({
        data: { userId: this.userId, leadPhone: msg.from, state: 'greeting', billable },
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

    // Conversa além do limite diário grátis: acumula o custo desta mensagem e,
    // ao atingir o mínimo configurado, dispara a cobrança automática (Asaas).
    // Não-fatal: falha aqui nunca pode impedir o bot de responder o lead.
    if (conv.billable) {
      await this.accrueOverage(config.dailyOverageCentsPerMsg, config.overageChargeThresholdCents)
        .catch((e) => console.error('[whatsapp:billing] erro ao acumular/cobrar excedente:', e));
    }

    // Dispara conversão na PRIMEIRA resposta (clique→conversa = lead via WhatsApp)
    const shouldFireConversion = !conv.conversionFired;
    if (shouldFireConversion) {
      await this.fireConversion(config.conversionId, config.conversionLabel, msg.from);
    }

    // Handoff: avisa o vendedor com o resumo
    if (result.done && result.state === 'handoff' && config.handoffContact) {
      await this.notifyVendor(config.handoffContact, msg.from, result.summary ?? '', transport);
    }

    // Lead QUALIFICADO (QUENTE) → envia a conversão de Lead server-side às DUAS
    // plataformas, uma única vez. Só no lead qualificado (não no 1º contato),
    // para os algoritmos otimizarem por QUALIDADE de lead, não volume de clique.
    //   • Meta CAPI (evento Lead)
    //   • Google Enhanced Conversions for Leads (upload pelo telefone)
    const isQualified = result.done && result.label === 'QUENTE';
    const shouldReport = isQualified && !conv.capiLeadFired;
    if (shouldReport) {
      await this.fireCapiLead(conv.id, msg.from, msg.ctwaClid);
      await this.fireGoogleLeadConversion(msg.from);
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
        capiLeadFired: conv.capiLeadFired || shouldReport,
      },
    });

    return { reply: result.reply, state: result.state };
  }

  // ── Cobrança de excedente ────────────────────────────────────────────────────
  // Acumula o custo desta mensagem e, ao atingir o mínimo configurado, dispara
  // uma cobrança Asaas (PIX/boleto/cartão via link) pelo valor acumulado.
  //
  // Concorrência: usa compare-and-swap (zera só se o valor não mudou desde a
  // leitura) para nunca gerar duas cobranças pro mesmo acumulado, mesmo se
  // duas conversas do mesmo usuário cruzarem o limite quase ao mesmo tempo.
  // Se a chamada ao Asaas falhar depois de já ter zerado, devolve o valor
  // reclamado ao acumulado — nenhum centavo do cliente final pode se perder.
  private async accrueOverage(centsPerMsg: number, thresholdCents: number): Promise<void> {
    const updated = await prisma.whatsappConfig.update({
      where: { userId: this.userId },
      data: { pendingOverageCents: { increment: centsPerMsg } },
    });
    if (updated.pendingOverageCents < thresholdCents) return;

    const claimAmount = updated.pendingOverageCents;
    const claim = await prisma.whatsappConfig.updateMany({
      where: { userId: this.userId, pendingOverageCents: claimAmount },
      data: { pendingOverageCents: 0 },
    });
    if (claim.count !== 1) return; // outra chamada concorrente já reclamou este acumulado

    try {
      if (!asaasConfigured()) {
        console.warn(`[whatsapp:billing] excedente de ${claimAmount} centavos (userId ${this.userId}) acumulado, mas ASAAS_API_KEY não configurada — cobrança pulada`);
        return;
      }
      if (!updated.billingCpfCnpj) {
        console.warn(`[whatsapp:billing] excedente de ${claimAmount} centavos (userId ${this.userId}) acumulado, mas falta CPF/CNPJ de faturamento — configure em WhatsApp (Leads IA)`);
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: this.userId }, select: { name: true, email: true } });
      if (!user) return;

      const customerId = updated.asaasCustomerId ?? await ensureAsaasCustomer({
        name: user.name,
        email: user.email,
        cpfCnpj: updated.billingCpfCnpj,
        externalReference: this.userId,
      });
      if (!updated.asaasCustomerId) {
        await prisma.whatsappConfig.update({ where: { userId: this.userId }, data: { asaasCustomerId: customerId } });
      }

      const charge = await createOverageCharge(
        customerId,
        claimAmount,
        'AdsGenius — excedente de conversas WhatsApp (Leads IA)',
      );

      await prisma.whatsappCharge.create({
        data: {
          userId: this.userId,
          amountCents: claimAmount,
          asaasPaymentId: charge.asaasPaymentId,
          invoiceUrl: charge.invoiceUrl,
          status: 'PENDING',
        },
      });

      await sendMail({
        to: user.email,
        subject: 'AdsGenius — cobrança do excedente de conversas WhatsApp',
        html: `<p>Olá, ${user.name}!</p>
<p>Seu WhatsApp (Leads IA) passou do limite diário de conversas grátis e acumulou
R$ ${(claimAmount / 100).toFixed(2)} em mensagens excedentes (R$ ${(centsPerMsg / 100).toFixed(2)} por mensagem).</p>
<p><a href="${charge.invoiceUrl}">Pagar agora (PIX, boleto ou cartão)</a></p>
<p>O bot continua funcionando normalmente enquanto isso.</p>`,
        text: `Seu WhatsApp (Leads IA) acumulou R$ ${(claimAmount / 100).toFixed(2)} em excedente. Pague em: ${charge.invoiceUrl}`,
      });
    } catch (e) {
      // Falhou ao cobrar (Asaas fora do ar, CPF inválido, etc.) — devolve o
      // valor reclamado para não perder o registro do excedente, e tenta de
      // novo quando o acumulado voltar a cruzar o limite.
      await prisma.whatsappConfig.update({
        where: { userId: this.userId },
        data: { pendingOverageCents: { increment: claimAmount } },
      });
      throw e;
    }
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

  // Envia o evento Lead ao Meta via CAPI. event_id estável por conversa para
  // deduplicar com o Pixel. Não-fatal: erro aqui não pode quebrar o atendimento.
  private async fireCapiLead(convId: string, leadPhone: string, ctwaClid?: string | null) {
    try {
      const capi = new CapiService(this.userId);
      const res = await capi.sendLead({
        phone: leadPhone,
        eventId: `lead_${convId}`,
        ctwaClid: ctwaClid ?? null,
      });
      if (res.ok) console.log(`[capi] Lead enviado (lead ${leadPhone}, conv ${convId})`);
      else console.warn(`[capi] Lead não enviado (lead ${leadPhone}): ${res.error}`);
    } catch (e) {
      console.error('[capi] erro inesperado ao enviar Lead:', e);
    }
  }

  // Envia a conversão de Lead ao Google Ads (server-side, Enhanced Conversions),
  // chamando a edge function do AdsGenius. Precisa do supabaseUserId do dono
  // (identidade unificada) para a função achar a conexão Google. Não-fatal.
  private async fireGoogleLeadConversion(leadPhone: string) {
    try {
      const base = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!base || !serviceKey) return; // sem credenciais Supabase configuradas

      const user = await prisma.user.findUnique({
        where: { id: this.userId },
        select: { supabaseUserId: true },
      });
      if (!user?.supabaseUserId) {
        console.log('[google-conv] usuário sem supabaseUserId (sem SSO) — pulando upload');
        return;
      }

      const resp = await fetch(`${base}/functions/v1/upload-lead-conversion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ user_id: user.supabaseUserId, phone: leadPhone }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.ok) console.log(`[google-conv] Lead enviado (lead ${leadPhone})`);
      else console.warn(`[google-conv] Lead não enviado (lead ${leadPhone}):`, data?.error ?? data?.partial_failure_error ?? resp.status);
    } catch (e) {
      console.error('[google-conv] erro inesperado ao enviar conversão:', e);
    }
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
