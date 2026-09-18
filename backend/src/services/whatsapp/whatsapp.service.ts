// Orquestrador da qualificação de leads via WhatsApp (agnóstico de transporte).
// Fluxo: mensagem recebida → carrega config + conversa → IA gera resposta →
// envia pelo transporte → dispara conversão (1ª msg) → handoff se qualificado.

import prisma from '../../lib/prisma.js';
import { resolveTransport, type InboundMessage } from './transport.js';
import {
  type CotacaoResultado,
  extrairDadosParaCotacao,
  montarNotaParaVendedor,
  cotarRespeitandoPreferencia,
  podeCotarAutomaticamente,
  REPLY_COTACAO_AGORA,
  REPLY_COTACAO_FALHOU,
  resolverIntegracao,
} from './cotacao.integration.js';
import { nextReply, type QualConfig, type QualTurn } from './qualification.service.js';
import { CapiService } from '../capi.service.js';
import { sendMail } from '../email.service.js';
import { asaasConfigured, ensureAsaasCustomer, createOverageCharge as createRechargeCharge } from '../asaas.service.js';

interface HistoryItem { role: 'user' | 'assistant'; text: string; at: string }

// Normaliza texto para comparação de palavra-gatilho: minúsculas, sem
// diacríticos (NFD + remoção dos combining marks) e sem espaços nas pontas —
// "Cotação" vira "cotacao", casando com "quero uma cotacao".
function normalizeForTrigger(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// O campo aceita UMA frase ou VÁRIAS separadas por vírgula (ex.: campanhas
// diferentes com mensagens pré-escritas diferentes, todas pro mesmo número).
// PURO: split, trim, descarta vazio ("a,,b" ou ", " nas pontas não vira
// gatilho fantasma que nunca casa).
export function parseTriggerKeywords(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// A mensagem do lead casa com ALGUM dos gatilhos configurados? Lista vazia
// (campo em branco) = sem restrição, atende todo mundo — comportamento de
// sempre, preservado.
export function matchesAnyTrigger(triggerField: string | null | undefined, messageText: string): boolean {
  const keywords = parseTriggerKeywords(triggerField ?? '');
  if (keywords.length === 0) return true;
  const msg = normalizeForTrigger(messageText);
  return keywords.some((k) => msg.includes(normalizeForTrigger(k)));
}

// Negócio "default" — mesmo sentinela do schema (WhatsappConfig.businessId) e
// do evolution.manager (DEFAULT_BUSINESS). Contas de hoje (1 config por
// usuário) continuam funcionando: businessId ausente = "default".
export const DEFAULT_BUSINESS = 'default';

export class WhatsappService {
  private businessId: string;

  constructor(private userId: string, businessId?: string | null) {
    this.businessId = businessId && businessId.trim() ? businessId : DEFAULT_BUSINESS;
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async getConfig() {
    return prisma.whatsappConfig.findUnique({
      where: { userId_businessId: { userId: this.userId, businessId: this.businessId } },
    });
  }

  // Lista os negócios (configs) da conta — para o seletor no painel.
  async listBusinesses() {
    return prisma.whatsappConfig.findMany({
      where: { userId: this.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        businessId: true,
        businessName: true,
        enabled: true,
        transport: true,
        transportConfig: true,
        createdAt: true,
      },
    });
  }

  // Remove um negócio não-padrão: desativa a config (não apaga conversas —
  // histórico fica). O negócio "default" nunca pode ser removido por aqui
  // (é o fallback das rotas/webhook legados).
  async removeBusiness() {
    if (this.businessId === DEFAULT_BUSINESS) {
      throw new Error('O negócio padrão não pode ser removido');
    }
    await prisma.whatsappConfig.updateMany({
      where: { userId: this.userId, businessId: this.businessId },
      data: { enabled: false, transport: 'none' },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // `transport`/`transportConfig` são geridos por /evolution/connect (modo
  // gerenciado, que grava a instância direto no banco) e pela seção
  // "Transporte avançado" (self-hosted) — não pelo formulário principal de
  // persona/perguntas. O frontend reenvia aqui o que tem em memória local, e
  // esse estado local só reflete `transport` depois de conectar (nunca
  // `transportConfig.instance`, que só existe no banco). Sem esta trava,
  // salvar QUALQUER outro campo (pergunta, gatilho, critério) sobrescrevia
  // `transportConfig` para `{}`, apagando a instância conectada — o bot
  // ficava mudo pra mensagens reais enquanto a tela ainda mostrava
  // "conectado" (esse status vem da Evolution, não deste campo). Caso real:
  // 15/09/2026.
  //
  // Regra: só aceita mudar transport/transportConfig quando o payload chega
  // COMPLETO para o que ele mesmo declara — gerenciado: `instance` presente
  // e nenhum campo de self-hosted; self-hosted: baseUrl+apiKey+instance
  // todos presentes; ou `'none'` explícito. Fora isso, preserva o que já
  // está gravado — melhor ignorar um envio incompleto do que apagar uma
  // conexão que funciona.
  private declaraTransporteCompleto(transport: unknown, cfg: Record<string, any>): boolean {
    if (transport === 'none') return true;
    if (transport !== 'evolution') return false;
    const selfHosted = Boolean(cfg.baseUrl || cfg.apiKey);
    if (selfHosted) return Boolean(cfg.baseUrl && cfg.apiKey && cfg.instance);
    return Boolean(cfg.instance);
  }

  async upsertConfig(data: Record<string, any>) {
    const existing = await this.getConfig();
    const incomingCfg: Record<string, any> = data.transportConfig ?? {};
    const mantemTransporteAtual = !this.declaraTransporteCompleto(data.transport, incomingCfg);
    const transport: string = mantemTransporteAtual ? (existing?.transport ?? 'none') : data.transport;
    const transportConfig: any = mantemTransporteAtual
      ? (existing?.transportConfig ?? {})
      : incomingCfg;

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
      triggerKeyword: data.triggerKeyword ?? null,
      transport,
      transportConfig,
      conversionId: data.conversionId ?? null,
      conversionLabel: data.conversionLabel ?? null,
      enabled: data.enabled ?? false,
      billingCpfCnpj: data.billingCpfCnpj ?? null,
    };
    return prisma.whatsappConfig.upsert({
      where: { userId_businessId: { userId: this.userId, businessId: this.businessId } },
      create: { userId: this.userId, businessId: this.businessId, ...base },
      update: base,
    });
  }

  // ── Uso/cobrança (para o painel do cliente) ─────────────────────────────────
  async getUsageStatus() {
    const config = await this.getConfig();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const [todayCount, lastCharges] = await Promise.all([
      prisma.whatsappConversation.count({
        where: { userId: this.userId, businessId: this.businessId, createdAt: { gte: startOfToday } },
      }),
      prisma.whatsappCharge.findMany({
        where: { userId: this.userId, businessId: this.businessId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
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

    // Carrega ou cria a conversa deste lead. Escopada por (userId, businessId,
    // leadPhone): o mesmo número pode falar com dois negócios da mesma conta,
    // e cada um vê uma conversa independente.
    let conv = await prisma.whatsappConversation.findUnique({
      where: {
        userId_businessId_leadPhone: { userId: this.userId, businessId: this.businessId, leadPhone: msg.from },
      },
    });
    if (!conv) {
      // Palavra-gatilho: com triggerKeyword configurado, uma conversa NOVA só
      // nasce se a 1ª mensagem contiver o gatilho (sem caixa/acentos). Sem o
      // gatilho, ignora em silêncio — ANTES de contar franquia/billable e de
      // chamar a IA: mensagem ignorada não pode consumir nada nem criar
      // conversa. Conversa já existente (ramo de baixo) nunca reavalia isto.
      if (!matchesAnyTrigger(config.triggerKeyword, msg.text)) {
        // Log inclui o texto RECEBIDO (truncado) — sem isso não dá pra saber se
        // o gatilho não bateu porque a mensagem realmente não continha a frase,
        // ou porque o texto extraído do payload não é o que o lead digitou.
        console.log(`[whatsapp:trigger] msg sem nenhum gatilho de "${config.triggerKeyword}" ignorada — texto recebido: ${JSON.stringify(msg.text.slice(0, 200))} (userId ${this.userId}, negócio ${this.businessId}, lead ${msg.from})`);
        return null;
      }

      // Limite diário: as primeiras N conversas NOVAS do dia são grátis; a
      // partir da (N+1)ª, toda mensagem do bot nesta conversa é cobrada.
      // Franquia é por negócio — cada negócio tem sua própria cota diária.
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const todayCount = await prisma.whatsappConversation.count({
        where: { userId: this.userId, businessId: this.businessId, createdAt: { gte: startOfToday } },
      });
      const billable = todayCount >= config.dailyFreeConversations;
      conv = await prisma.whatsappConversation.create({
        data: { userId: this.userId, businessId: this.businessId, leadPhone: msg.from, state: 'greeting', billable },
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
    const result = await nextReply(this.userId, cfg, turns, conv.questionsAsked, conv.botMessages);

    // ── Cotação na hora (integração personalizada, ver cotacao.integration.ts) ──
    // Decidido ANTES de enviar: se esta conta tem a integração ligada, o lead é
    // QUENTE e pessoa física com idades válidas, a resposta de encerramento
    // vira a frase fixa "vou te passar uma cotação agora" — e o código a
    // cumpre logo abaixo. Em qualquer outro caso a resposta da IA segue
    // intacta, que é o comportamento de todo cliente do AdsGenius.
    const integracao = process.env.COTE_QUOTE_USER
      ? resolverIntegracao({
        userId: this.userId,
        email: (await prisma.user.findUnique({ where: { id: this.userId }, select: { email: true } }))?.email,
      })
      : null;
    const dadosLead = result.done ? extrairDadosParaCotacao(result.dados) : null;
    const vaiCotar = Boolean(integracao) && result.done && result.label === 'QUENTE' && podeCotarAutomaticamente(dadosLead);
    const replyFinal = vaiCotar ? REPLY_COTACAO_AGORA : result.reply;

    // Envia a resposta pelo transporte configurado
    const transport = resolveTransport(config.transport, config.transportConfig as Record<string, unknown>);
    await transport.sendText(msg.from, replyFinal);

    history.push({ role: 'assistant', text: replyFinal, at: new Date().toISOString() });

    // A promessa acima é cumprida aqui. Falhou o Cote+? O lead recebe uma
    // mensagem honesta ("o consultor te envia em instantes") e o vendedor
    // recebe as idades para cotar à mão — ninguém fica no vácuo.
    let notaVendedor = '';
    let textoCotacao = '';
    if (vaiCotar && integracao && dadosLead) {
      let cotacao: CotacaoResultado | null = null;
      let falha: string | undefined;
      try {
        cotacao = await cotarRespeitandoPreferencia(integracao, dadosLead);
      } catch (e) {
        falha = e instanceof Error ? e.message : String(e);
        console.error('[whatsapp:cotacao] falha ao pedir cotação ao Cote+:', e);
      }
      const textoAoLead = cotacao?.ok && cotacao.texto ? cotacao.texto : REPLY_COTACAO_FALHOU;
      await transport.sendText(msg.from, textoAoLead).catch((e) =>
        console.error('[whatsapp:cotacao] falha ao enviar cotação ao lead:', e),
      );
      history.push({ role: 'assistant', text: textoAoLead, at: new Date().toISOString() });
      notaVendedor = montarNotaParaVendedor(dadosLead, cotacao, falha);
      textoCotacao = textoAoLead;
    } else if (integracao && result.done && result.label === 'QUENTE') {
      // Integração ligada mas sem como cotar (CNPJ, idades ausentes): o
      // vendedor fica sabendo o porquê e não repete as perguntas.
      notaVendedor = montarNotaParaVendedor(dadosLead, null);
    }

    // Dispara conversão na PRIMEIRA resposta (clique→conversa = lead via WhatsApp)
    const shouldFireConversion = !conv.conversionFired;
    if (shouldFireConversion) {
      await this.fireConversion(config.conversionId, config.conversionLabel, msg.from);
    }

    // Handoff: avisa o vendedor com o resumo
    if (result.done && result.state === 'handoff' && config.handoffContact) {
      const resumo = [result.summary ?? '', notaVendedor].filter(Boolean).join('\n');
      await this.notifyVendor(config.handoffContact, msg.from, resumo, transport);
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

    // O simulador da tela mostra só o que volta aqui: com cotação, volta as
    // duas mensagens que o lead recebeu.
    return { reply: textoCotacao ? `${replyFinal}\n\n${textoCotacao}` : replyFinal, state: result.state };
  }

  // ── Saldo pré-pago (sem dívida) ──────────────────────────────────────────────
  // Consome 1 mensagem do saldo pago, atomicamente (só decrementa se > 0) —
  // evita sobrar saldo negativo sob concorrência. Retorna false se não havia
  // saldo (bot deve ficar mudo).
  private async tryConsumePrepaidMessage(): Promise<boolean> {
    const claim = await prisma.whatsappConfig.updateMany({
      where: { userId: this.userId, businessId: this.businessId, prepaidMessagesRemaining: { gt: 0 } },
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
    // Escopada por negócio: cada negócio tem seu próprio saldo/cobrança.
    const openCharge = await prisma.whatsappCharge.findFirst({
      where: { userId: this.userId, businessId: this.businessId, status: 'PENDING' },
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
    // índice único parcial em pendingKey (`${userId}:${businessId}`) garante,
    // no próprio banco, que só uma chamada concorrente consegue este insert;
    // as demais caem no catch e desistem (evita criar duas cobranças reais se
    // dois leads do MESMO negócio baterem o limite quase ao mesmo tempo — o
    // negócio B pode gerar a sua própria cobrança em paralelo, sem conflito).
    let placeholder;
    try {
      placeholder = await prisma.whatsappCharge.create({
        data: {
          userId: this.userId,
          businessId: this.businessId,
          amountCents: config.rechargeAmountCents,
          messagesGranted,
          asaasPaymentId: `pending:${this.userId}:${this.businessId}:${Date.now()}`,
          invoiceUrl: '',
          status: 'PENDING',
          pendingKey: `${this.userId}:${this.businessId}`,
        },
      });
    } catch {
      return; // outra chamada concorrente já reclamou o slot
    }

    try {
      // externalReference: mantém EXATAMENTE o formato legado (só userId)
      // para o negócio "default" — clientes que já têm asaasCustomerId salvo
      // nunca chamam ensureAsaasCustomer de novo (cacheado em config), mas
      // preservar o formato evita duplicar cliente Asaas caso essa chamada
      // precise rodar de novo (ex: charge anterior falhou antes de salvar o
      // id). Negócios extras usam "userId:businessId" — cliente Asaas
      // separado por negócio, como pedido (CPF/CNPJ pode ser diferente).
      const externalReference = this.businessId === DEFAULT_BUSINESS
        ? this.userId
        : `${this.userId}:${this.businessId}`;
      const customerId = config.asaasCustomerId ?? await ensureAsaasCustomer({
        name: user.name,
        email: user.email,
        cpfCnpj: config.billingCpfCnpj,
        externalReference,
      });
      if (!config.asaasCustomerId) {
        await prisma.whatsappConfig.update({
          where: { userId_businessId: { userId: this.userId, businessId: this.businessId } },
          data: { asaasCustomerId: customerId },
        });
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
  //
  // ⚠️ Usa uma ação de conversão PRÓPRIA ("Lead Qualificado"), separada da
  // "Lead — AdsGenius" que o clique cru no WhatsApp do site já dispara.
  // Achado ao vivo 18/09/2026 (conta Tabelasamel): as duas caíam na MESMA
  // ação antes disso — o Smart Bidding do Google via uma pilha só, misturando
  // clique curioso (dispara na hora, sem esforço) com lead de verdade
  // qualificado pelo bot (só depois de uma conversa inteira). O clique cru
  // afoga o sinal bom em volume, e a IA de lance otimiza pro que é fácil de
  // conseguir, não pro que vira venda. Separar os dois deixa o Smart Bidding
  // aprender com o sinal certo.
  //
  // ⚠️ PENDENTE DE ATIVAÇÃO (decisão do Luiz, 18/09/2026): a ação
  // "Lead Qualificado — AdsGenius" ainda NÃO existe no Google Ads e a
  // campanha "[Google] Pesquisa" ainda não foi configurada para otimizar por
  // ela — isso fica pra depois de ~20/09 (janela de observação em andamento,
  // não pode mudar o alvo de otimização no meio dela). Até lá, esta chamada
  // falha (não-fatal, só loga) porque a ação de destino não existe — é o
  // comportamento esperado, não um bug.
  private static readonly QUALIFIED_CONVERSION_ACTION = 'Lead Qualificado — AdsGenius';

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
        body: JSON.stringify({
          user_id: user.supabaseUserId,
          phone: leadPhone,
          conversion_action_name: WhatsappService.QUALIFIED_CONVERSION_ACTION,
        }),
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
  // pendingKey: null libera o slot do índice único parcial — sem isso, o
  // usuário+negócio nunca mais conseguiria gerar outra recarga depois da primeira.
  const claimed = await prisma.whatsappCharge.updateMany({
    where: { asaasPaymentId, status: 'PENDING' },
    data: { status: 'PAID', pendingKey: null },
  });
  if (claimed.count !== 1) return;

  // Credita o saldo do NEGÓCIO certo — a cobrança já carrega o businessId
  // gravado no momento em que foi criada (ver ensureRechargeCharge), então o
  // webhook credita sempre o negócio que efetivamente gerou a cobrança,
  // mesmo que a conta tenha vários negócios em paralelo.
  await prisma.whatsappConfig.update({
    where: { userId_businessId: { userId: charge.userId, businessId: charge.businessId } },
    data: { prepaidMessagesRemaining: { increment: charge.messagesGranted } },
  });
  console.log(`[whatsapp:billing] recarga confirmada: +${charge.messagesGranted} mensagens (userId ${charge.userId}, negócio ${charge.businessId}, pagamento ${asaasPaymentId})`);
}
