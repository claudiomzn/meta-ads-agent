// Orquestrador da qualificação de leads via WhatsApp (agnóstico de transporte).
// Fluxo: mensagem recebida → carrega config + conversa → IA gera resposta →
// envia pelo transporte → dispara conversão (1ª msg) → handoff se qualificado.

import prisma from '../../lib/prisma.js';
import { resolveTransport, type InboundMessage } from './transport.js';
import { nextReply, type QualConfig, type QualTurn } from './qualification.service.js';
import { CapiService } from '../capi.service.js';
import { sendMail } from '../email.service.js';
import { asaasConfigured, ensureAsaasCustomer, createOverageCharge as createRechargeCharge } from '../asaas.service.js';

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
    const dailyFreeConversations = config?.dailyFreeConversations ?? 12;
    const prepaidMessagesRemaining = config?.prepaidMessagesRemaining ?? 0;
    return {
      dailyFreeConversations,
      dailyOverageCentsPerMsg: config?.dailyOverageCentsPerMsg ?? 15,
      rechargeAmountCents: config?.rechargeAmountCents ?? 2000,
      prepaidMessagesRemaining,
      todayConversations: todayCount,
      billingCpfCnpj: config?.billingCpfCnpj ?? null,
      charges: lastCharges,
      // Sinal pro painel: o bot está mudo pra leads novos/excedentes agora?
      paused: todayCount >= dailyFreeConversations && prepaidMessagesRemaining <= 0,
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

    // Conversa além da franquia diária: só responde se houver saldo pago. Sem
    // saldo, o bot fica MUDO (nunca responde "fiado") e dispara uma cobrança
    // de recarga — quando o Asaas confirmar o pagamento (webhook), o saldo é
    // creditado e as próximas mensagens voltam a ser respondidas.
    if (conv.billable) {
      const hasCredit = await this.tryConsumePrepaidMessage();
      if (!hasCredit) {
        await this.ensureRechargeCharge(config).catch((e) =>
          console.error('[whatsapp:billing] erro ao gerar cobrança de recarga:', e));
        await prisma.whatsappConversation.update({
          where: { id: conv.id },
          data: { history: history as unknown as object },
        });
        console.log(`[whatsapp:billing] bot mudo p/ userId ${this.userId} (lead ${msg.from}) — sem saldo pago`);
        return null;
      }
    }

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

  // ── Saldo pré-pago (sem dívida) ──────────────────────────────────────────────
  // Consome 1 mensagem do saldo pago, atomicamente (só decrementa se > 0) —
  // evita sobrar saldo negativo sob concorrência. Retorna false se não havia
  // saldo (bot deve ficar mudo).
  private async tryConsumePrepaidMessage(): Promise<boolean> {
    const claim = await prisma.whatsappConfig.updateMany({
      where: { userId: this.userId, prepaidMessagesRemaining: { gt: 0 } },
      data: { prepaidMessagesRemaining: { decrement: 1 } },
    });
    return claim.count === 1;
  }

  // Garante que existe uma cobrança de recarga em aberto quando o saldo zera.
  // Não gera cobrança duplicada enquanto já houver uma PENDING — o cliente só
  // recebe um link de pagamento por vez.
  private async ensureRechargeCharge(config: {
    rechargeAmountCents: number;
    dailyOverageCentsPerMsg: number;
    dailyFreeConversations: number;
    billingCpfCnpj: string | null;
    asaasCustomerId: string | null;
  }): Promise<void> {
    // Checagem rápida (não é a garantia de corretude — só evita trabalho
    // desnecessário no caminho comum, quando já existe cobrança aberta).
    const openCharge = await prisma.whatsappCharge.findFirst({
      where: { userId: this.userId, status: 'PENDING' },
    });
    if (openCharge) return;

    if (!asaasConfigured()) {
      console.warn(`[whatsapp:billing] saldo zerado (userId ${this.userId}) — ASAAS_API_KEY não configurada, bot seguirá mudo`);
      return;
    }
    if (!config.billingCpfCnpj) {
      console.warn(`[whatsapp:billing] saldo zerado (userId ${this.userId}) — falta CPF/CNPJ de faturamento, configure em WhatsApp (Leads IA)`);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: this.userId }, select: { name: true, email: true } });
    if (!user) return;

    const messagesGranted = Math.floor(config.rechargeAmountCents / config.dailyOverageCentsPerMsg);

    // Reclama o "direito" de criar a cobrança ANTES de chamar o Asaas — o
    // índice único parcial em pendingUserId garante, no próprio banco, que só
    // uma chamada concorrente consegue este insert; as demais caem no catch e
    // desistem (evita criar duas cobranças reais se dois leads baterem o
    // limite quase ao mesmo tempo).
    let placeholder;
    try {
      placeholder = await prisma.whatsappCharge.create({
        data: {
          userId: this.userId,
          amountCents: config.rechargeAmountCents,
          messagesGranted,
          asaasPaymentId: `pending:${this.userId}:${Date.now()}`,
          invoiceUrl: '',
          status: 'PENDING',
          pendingUserId: this.userId,
        },
      });
    } catch {
      return; // outra chamada concorrente já reclamou o slot
    }

    try {
      const customerId = config.asaasCustomerId ?? await ensureAsaasCustomer({
        name: user.name,
        email: user.email,
        cpfCnpj: config.billingCpfCnpj,
        externalReference: this.userId,
      });
      if (!config.asaasCustomerId) {
        await prisma.whatsappConfig.update({ where: { userId: this.userId }, data: { asaasCustomerId: customerId } });
      }

      const charge = await createRechargeCharge(
        customerId,
        config.rechargeAmountCents,
        'AdsGenius — recarga de mensagens WhatsApp (Leads IA)',
      );

      // O saldo só é creditado quando o webhook do Asaas confirmar o pagamento
      // (ver whatsapp.routes.ts /webhook/asaas) — nunca aqui, para nunca responder fiado.
      await prisma.whatsappCharge.update({
        where: { id: placeholder.id },
        data: { asaasPaymentId: charge.asaasPaymentId, invoiceUrl: charge.invoiceUrl },
      });

      await sendMail({
        to: user.email,
        subject: 'AdsGenius — seu WhatsApp (Leads IA) está pausado, pague para reativar',
        html: `<p>Olá, ${user.name}!</p>
<p>Seu WhatsApp (Leads IA) atingiu o limite de ${config.dailyFreeConversations} conversas grátis de hoje e o
saldo pago acabou. O bot está <strong>pausado</strong> e não vai responder novos leads até você recarregar —
ou esperar a virada do dia, quando as conversas grátis renovam sozinhas.</p>
<p><a href="${charge.invoiceUrl}">Pagar R$ ${(config.rechargeAmountCents / 100).toFixed(2)} e reativar agora (PIX, boleto ou cartão)</a></p>
<p>Essa recarga libera mais ${messagesGranted} mensagens do bot.</p>`,
        text: `Seu bot está pausado. Pague R$ ${(config.rechargeAmountCents / 100).toFixed(2)} para reativar: ${charge.invoiceUrl}`,
      });
    } catch (e) {
      // Falhou ao criar a cobrança no Asaas (fora do ar, CPF inválido, etc.) —
      // libera o slot apagando o placeholder, pra próxima mensagem tentar de novo.
      await prisma.whatsappCharge.delete({ where: { id: placeholder.id } }).catch(() => {});
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

// Credita o saldo pré-pago quando o Asaas confirma que uma recarga foi paga
// (chamado pelo webhook — ver whatsapp.routes.ts). Idempotente: cobrança que
// já estiver PAID é ignorada (o Asaas pode reenviar o mesmo evento).
export async function creditPaidRecharge(asaasPaymentId: string): Promise<void> {
  const charge = await prisma.whatsappCharge.findUnique({ where: { asaasPaymentId } });
  if (!charge) {
    console.warn(`[whatsapp:billing] webhook Asaas: cobrança ${asaasPaymentId} não encontrada`);
    return;
  }
  if (charge.status === 'PAID') return; // já processado (reenvio do webhook)

  // updateMany com status atual no WHERE — evita creditar 2x se o Asaas
  // reenviar o evento quase ao mesmo tempo (só uma chamada "ganha" o PENDING).
  // pendingUserId: null libera o slot do índice único parcial — sem isso, o
  // usuário nunca mais conseguiria gerar outra recarga depois da primeira.
  const claimed = await prisma.whatsappCharge.updateMany({
    where: { asaasPaymentId, status: 'PENDING' },
    data: { status: 'PAID', pendingUserId: null },
  });
  if (claimed.count !== 1) return;

  await prisma.whatsappConfig.update({
    where: { userId: charge.userId },
    data: { prepaidMessagesRemaining: { increment: charge.messagesGranted } },
  });
  console.log(`[whatsapp:billing] recarga confirmada: +${charge.messagesGranted} mensagens (userId ${charge.userId}, pagamento ${asaasPaymentId})`);
}
