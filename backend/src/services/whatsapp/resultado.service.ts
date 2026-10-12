// O que acontece quando o VENDEDOR responde ao aviso do lead — e o lembrete
// que cobra resposta dele nos dias 2, 5 e 10.
//
// Por que isto existe (princípio do produto, Luiz 12/09/2026): o app mede
// CUSTO e para no lead. Quem sabe se o lead virou venda é o vendedor, e esse
// dado morria na conversa dele — então "lucro" seguia sendo estimativa. Aqui o
// desfecho entra pelo caminho que o vendedor já usa: ele responde o próprio
// aviso no WhatsApp ("fechou 1200", "perdeu preço") e o app registra a venda
// na MESMA tabela da tela de Vendas, subindo a conversão ao Google e à Meta.
//
// Duas travas que não se negociam:
//   • Só o número cadastrado como vendedor (handoffContact) entra aqui.
//   • Este canal NUNCA responde ao lead. Nada daqui sai para o número dele.

import prisma from '../../lib/prisma.js';
import { LogTransport, PREFIXO_ENSAIO, resolveTransport, type InboundMessage, type WhatsappTransport } from './transport.js';
import { chaveDoTelefone } from './funil.js';
import {
  comoChamarOLead,
  lerValorEmCentavos,
  dentroDoAtendimento,
  escolherEntreCandidatos,
  escolherLead,
  interpretarRespostaDoVendedor,
  lembreteDevido,
  MOTIVO_LEGIVEL,
  reais,
  type LeadAberto,
  type MotivoPerda,
  type RespostaDoVendedor,
} from './resultado.js';
import { registrarVendaNasPlataformas } from './venda.externa.js';
import { cliqueDaConversa } from './clique.js';

/** A mensagem veio do número cadastrado como vendedor? */
export function ehOVendedor(handoffContact: string | null | undefined, from: string): boolean {
  if (!handoffContact?.trim()) return false;
  // Ensaio do simulador nunca é o vendedor: o `teste:` seria descartado pela
  // normalização e um ensaio apontado para o número dele viraria registro.
  if (from.startsWith(PREFIXO_ENSAIO)) return false;
  const a = chaveDoTelefone(handoffContact);
  const b = chaveDoTelefone(from);
  return Boolean(a && b && a === b);
}

/** Quantos leads em aberto o bot oferece/considera ao desempatar. */
const LEADS_ABERTOS_MAX = 20;

/** A pendência ("qual deles?") vence: responder "2" um dia depois não pode
 *  cair numa lista que já mudou. */
const PENDENCIA_VALIDA_MS = 24 * 60 * 60 * 1000;

interface ConversaAberta extends LeadAberto {
  origemCanal: string | null;
  origemCampanhaId: string | null;
}

async function leadsAbertos(userId: string, businessId: string): Promise<ConversaAberta[]> {
  const linhas = await prisma.whatsappConversation.findMany({
    where: {
      userId, businessId,
      state: 'handoff',
      // Em aberto = sem desfecho. 'negociando' NÃO é desfecho: o vendedor que
      // disse "em negociação" na segunda e "fechou 1200" na sexta precisa
      // conseguir registrar a venda — sem isto o lead ficava inalcançável.
      OR: [{ resultado: null }, { resultado: 'negociando' }],
      NOT: { leadPhone: { startsWith: PREFIXO_ENSAIO } },
    },
    orderBy: [{ handoffEm: 'desc' }, { updatedAt: 'desc' }],
    take: LEADS_ABERTOS_MAX,
    select: {
      id: true, leadPhone: true, leadNome: true, handoffEm: true,
      origemCanal: true, origemCampanhaId: true,
    },
  });
  return linhas.map((l) => ({
    id: l.id, leadPhone: l.leadPhone, nome: l.leadNome, handoffEm: l.handoffEm,
    origemCanal: l.origemCanal, origemCampanhaId: l.origemCampanhaId,
  }));
}

/**
 * Trata uma mensagem vinda do vendedor. Devolve o texto que foi enviado a ele,
 * ou null quando a mensagem não é um desfecho (aí o bot fica em SILÊNCIO — o
 * vendedor não está conversando com um robô, está anotando um resultado).
 */
export async function tratarRespostaDoVendedor(
  userId: string,
  businessId: string,
  config: { handoffContact: string | null; transport: string; transportConfig: unknown },
  msg: InboundMessage,
): Promise<{ reply: string; state: string } | null> {
  const abertos = await leadsAbertos(userId, businessId);
  const pendencia = await lerPendencia(userId, businessId);

  // 1a) Pendência à espera do VALOR ("fechou" sem número): a mensagem seguinte
  // com um número é o valor da venda daquele lead.
  if (pendencia && esperandoValor(pendencia.resposta) && pendencia.candidatoIds.length === 1) {
    const lead = abertos.find((a) => a.id === pendencia.candidatoIds[0]);
    if (lead) {
      const nova = interpretarRespostaDoVendedor(msg.text);
      if (nova && !esperandoValor(nova)) {
        await apagarPendencia(userId, businessId);
        return await aplicar(userId, businessId, config, msg, lead, nova);
      }
      const valorCents = lerValorEmCentavos(msg.text);
      // Piso de R$ 10 no número solto: à espera de valor, um "2" é muito mais
      // provavelmente "o segundo da lista" ou dedo escorregado que uma venda
      // de dois reais — e valor errado contamina a medição de lucro.
      if (valorCents !== null && valorCents >= VALOR_MINIMO_SOLTO_CENTS) {
        await apagarPendencia(userId, businessId);
        return await aplicar(userId, businessId, config, msg, lead, { resultado: 'venda', valorCents, pista: '' });
      }
    }
  }

  // 1b) O vendedor está respondendo "qual deles?" — resolve pela lista exibida.
  if (pendencia) {
    const candidatos = abertos.filter((a) => pendencia.candidatoIds.includes(a.id));
    const ordenados = ordenarComo(candidatos, pendencia.candidatoIds);
    const escolhidoLead = escolherEntreCandidatos(msg.text, ordenados);
    const escolhido = escolhidoLead ? ordenados.find((c) => c.id === escolhidoLead.id) : undefined;
    if (escolhido) {
      await apagarPendencia(userId, businessId);
      // Se a mesma mensagem também traz um desfecho novo ("2 fechou 1500"),
      // ele vale mais que o guardado — é o que o vendedor acabou de dizer.
      const agora = interpretarRespostaDoVendedor(msg.text);
      const resposta = agora && !(agora.resultado === 'venda' && agora.valorCents === undefined)
        ? agora
        : pendencia.resposta;
      return await aplicar(userId, businessId, config, msg, escolhido, resposta);
    }
  }

  // 2) Mensagem nova: é um desfecho?
  const resposta = interpretarRespostaDoVendedor(msg.text);
  if (!resposta) return null;

  const escolha = abertos.length
    ? escolherLead({ citacao: msg.citacao, pista: resposta.pista, abertos })
    : {};
  if (escolha.lead) {
    const lead = abertos.find((a) => a.id === escolha.lead!.id)!;
    return await aplicar(userId, businessId, config, msg, lead, resposta);
  }

  // Nenhum lead EM ABERTO casou. Antes de dizer "não achei", olha os que já
  // têm desfecho: o vendedor repetindo "fechou 1200" (ou citando um aviso
  // antigo) precisa ouvir que aquilo JÁ está registrado — "não encontrei"
  // soaria como se nada tivesse sido gravado, e ele registraria de novo.
  if (!escolha.candidatos?.length) {
    const jaResolvido = await leadJaResolvido(userId, businessId, msg.citacao, resposta.pista);
    if (jaResolvido) return await responder(config, msg, textoDoJaResolvido(jaResolvido));
    return await responder(config, msg, 'Não encontrei nenhum lead em aberto para registrar. 🤔');
  }

  // 3) Dúvida: pergunta de volta e guarda o que ele já disse. NUNCA chuta —
  // venda no lead errado estraga a medição e sobe a conversão do clique errado.
  const candidatos = escolha.candidatos;
  await gravarPendencia(userId, businessId, resposta, candidatos.map((c) => c.id));
  const lista = candidatos.map((c, i) => `${i + 1}) ${comoChamarOLead(c)}`).join('\n');
  return await responder(
    config, msg,
    `Qual destes leads? Responda com o número (ou o nome):\n${lista}`,
  );
}

/** Piso do valor aceito como "número solto" na resposta seguinte a "fechou". */
const VALOR_MINIMO_SOLTO_CENTS = 1000;

/** "fechou" sem valor: ainda falta o número para poder registrar. */
function esperandoValor(r: RespostaDoVendedor): boolean {
  return r.resultado === 'venda' && r.valorCents === undefined;
}

interface LeadResolvido {
  nome: string;
  resultado: string;
  vendaValorCents: number | null;
  motivoPerda: string | null;
}

/** Lead deste negócio que JÁ tem desfecho e casa com a citação/pista. Janela
 *  de 30 dias: desfecho de meses atrás não é o que o vendedor respondeu. */
async function leadJaResolvido(
  userId: string, businessId: string, citacao: string | null | undefined, pista: string,
): Promise<LeadResolvido | null> {
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const linhas = await prisma.whatsappConversation.findMany({
    where: {
      userId, businessId,
      resultado: { in: ['venda', 'perdido'] },
      resultadoEm: { gte: desde },
      NOT: { leadPhone: { startsWith: PREFIXO_ENSAIO } },
    },
    orderBy: { resultadoEm: 'desc' },
    take: LEADS_ABERTOS_MAX,
    select: {
      id: true, leadPhone: true, leadNome: true, handoffEm: true,
      resultado: true, vendaValorCents: true, motivoPerda: true,
    },
  });
  if (!linhas.length) return null;
  const abertos: LeadAberto[] = linhas.map((l) => ({
    id: l.id, leadPhone: l.leadPhone, nome: l.leadNome, handoffEm: l.handoffEm,
  }));
  const escolha = escolherLead({ citacao, pista, abertos });
  // Só quando NÃO há dúvida — aqui também não se chuta.
  const achado = escolha.lead ? linhas.find((l) => l.id === escolha.lead!.id) : undefined;
  if (!achado) return null;
  return {
    nome: comoChamarOLead({ nome: achado.leadNome, leadPhone: achado.leadPhone }),
    resultado: String(achado.resultado),
    vendaValorCents: achado.vendaValorCents,
    motivoPerda: achado.motivoPerda,
  };
}

function textoDoJaResolvido(l: LeadResolvido): string {
  if (l.resultado === 'venda') {
    const valor = l.vendaValorCents ? ` de R$ ${reais(l.vendaValorCents)}` : '';
    return `Essa venda${valor} de ${l.nome} já estava registrada — não registrei de novo. 👍`;
  }
  const motivo = l.motivoPerda && l.motivoPerda in MOTIVO_LEGIVEL
    ? ` (${MOTIVO_LEGIVEL[l.motivoPerda as MotivoPerda]})`
    : '';
  return `${l.nome} já estava marcado como perdido${motivo}. Se precisar corrigir, me chame no app.`;
}

/** Mantém a ordem em que os candidatos foram listados ao vendedor — é o que dá
 *  sentido a ele responder "2". */
function ordenarComo(candidatos: ConversaAberta[], ids: string[]): ConversaAberta[] {
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  return ids.map((id) => porId.get(id)).filter((c): c is ConversaAberta => Boolean(c));
}

async function aplicar(
  userId: string,
  businessId: string,
  config: { transport: string; transportConfig: unknown },
  msg: InboundMessage,
  lead: ConversaAberta,
  resposta: RespostaDoVendedor,
): Promise<{ reply: string; state: string }> {
  const nome = comoChamarOLead(lead);

  if (resposta.resultado === 'negociando') {
    // "em negociação" NÃO é desfecho: rezera o relógio dos lembretes (volta a
    // cobrar em 2 dias) em vez de calar para sempre. Lead em negociação que o
    // vendedor esquece é exatamente o que o lembrete existe para pegar.
    await prisma.whatsappConversation.update({
      where: { id: lead.id },
      data: {
        resultado: 'negociando', resultadoEm: new Date(),
        handoffEm: new Date(), lembretesEnviados: 0,
      },
    });
    return await responder(config, msg, `📌 Anotei: ${nome} em negociação. Te lembro em 2 dias.`);
  }

  if (resposta.resultado === 'perdido') {
    const motivo: MotivoPerda = resposta.motivo ?? 'outro';
    await prisma.whatsappConversation.update({
      where: { id: lead.id },
      data: {
        resultado: 'perdido', resultadoEm: new Date(),
        motivoPerda: motivo, motivoPerdaTexto: resposta.motivoTexto?.slice(0, 300) ?? null,
      },
    });
    return await responder(config, msg, `📕 Anotei: ${nome} perdido (${MOTIVO_LEGIVEL[motivo]}).`);
  }

  // Venda sem valor não é gravável: `closed_sales.amount_brl > 0` e, pior,
  // venda com valor zero empurra a média de receita para baixo e faz o agente
  // propor pausar a campanha que está vendendo. Pergunta em vez de inventar.
  if (resposta.valorCents === undefined) {
    await gravarPendencia(userId, businessId, resposta, [lead.id]);
    return await responder(config, msg, `Fechou com ${nome}, ótimo! 🎉 Por quanto? (ex.: 1200 ou 1.200,00)`);
  }

  return await registrarVenda(userId, businessId, config, msg, lead, resposta.valorCents);
}

async function registrarVenda(
  userId: string,
  businessId: string,
  config: { transport: string; transportConfig: unknown },
  msg: InboundMessage,
  lead: ConversaAberta,
  valorCents: number,
): Promise<{ reply: string; state: string }> {
  const nome = comoChamarOLead(lead);

  // ⭐ UMA VEZ SÓ POR LEAD, garantido no banco: só quem conseguir virar a
  // linha de `resultado != venda` para 'venda' segue adiante. Duas mensagens
  // do vendedor quase juntas ("fechou 1200" repetido) não podem gravar duas
  // vendas nem subir dois eventos de conversão.
  // ⚠️ `OR` explícito com `resultado: null`, não `NOT: { resultado: 'venda' }`:
  // em SQL, `NOT (resultado = 'venda')` com a coluna NULA é NULL, não TRUE —
  // o lead em aberto (resultado null), que é o caso COMUM, ficaria de fora e
  // nenhuma venda seria gravada. Pego por teste.
  const ganhou = await prisma.whatsappConversation.updateMany({
    where: { id: lead.id, OR: [{ resultado: null }, { resultado: { notIn: ['venda'] } }] },
    data: {
      resultado: 'venda', resultadoEm: new Date(),
      vendaValorCents: valorCents,
    },
  });
  if (ganhou.count !== 1) {
    return await responder(config, msg, `Essa venda de ${nome} já estava registrada — não registrei de novo. 👍`);
  }
  await apagarPendencia(userId, businessId);

  const clique = await cliqueDaConversa(lead.id);
  const envio = await registrarVendaNasPlataformas({
    userId,
    telefone: lead.leadPhone,
    valorCents,
    nome: lead.nome,
    // Campanha só quando a origem é GOOGLE — ver venda.externa.ts.
    campanhaGoogleId: lead.origemCanal === 'google' ? lead.origemCampanhaId : null,
    clique,
  });

  await prisma.whatsappConversation.update({
    where: { id: lead.id },
    data: { vendaSaleId: envio.saleId, vendaRegistradaEm: new Date() },
  });

  const linha = `✅ Venda de R$ ${reais(valorCents)} registrada para ${nome}`;
  // Nunca "sucesso" quando a plataforma recusou (CLAUDE.md): o vendedor fica
  // sabendo que a venda está anotada e o que não subiu.
  const foram = [
    envio.google === 'enviada' ? 'Google' : null,
    envio.meta === 'enviada' ? 'Meta' : null,
  ].filter(Boolean);
  const aviso = foram.length === 2
    ? ''
    : `\n⚠️ ${foram.length ? `Enviada ao ${foram[0]}, mas não` : 'Não'} subiu às plataformas${envio.detalhe ? ` (${envio.detalhe})` : ''}. A venda está registrada no app.`;
  return await responder(config, msg, `${linha}${aviso}`);
}

async function responder(
  config: { transport: string; transportConfig: unknown },
  msg: InboundMessage,
  texto: string,
): Promise<{ reply: string; state: string }> {
  const transport = transporteDoVendedor(config, msg);
  await transport.sendText(msg.from, texto).catch((e) =>
    console.error('[whatsapp:vendedor] falha ao confirmar ao vendedor:', e));
  return { reply: texto, state: 'vendedor' };
}

function transporteDoVendedor(
  config: { transport: string; transportConfig: unknown },
  msg: InboundMessage,
): WhatsappTransport {
  // Ensaio não manda nada a ninguém — mesma regra do resto do fluxo.
  return msg.ensaio
    ? new LogTransport()
    : resolveTransport(config.transport, (config.transportConfig ?? {}) as Record<string, unknown>);
}

// ── Pendência "qual deles?" ────────────────────────────────────────────────

interface PendenciaLida {
  resposta: RespostaDoVendedor;
  candidatoIds: string[];
}

async function lerPendencia(userId: string, businessId: string): Promise<PendenciaLida | null> {
  const linha = await prisma.vendedorPendencia.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
  if (!linha) return null;
  if (Date.now() - linha.updatedAt.getTime() > PENDENCIA_VALIDA_MS) {
    await apagarPendencia(userId, businessId);
    return null;
  }
  const resposta = linha.resposta as unknown as RespostaDoVendedor;
  const candidatoIds = Array.isArray(linha.candidatos) ? (linha.candidatos as unknown[]).map(String) : [];
  if (!resposta?.resultado || candidatoIds.length === 0) return null;
  return { resposta, candidatoIds };
}

async function gravarPendencia(
  userId: string, businessId: string, resposta: RespostaDoVendedor, candidatoIds: string[],
): Promise<void> {
  const dados = {
    resposta: resposta as unknown as object,
    candidatos: candidatoIds as unknown as object,
  };
  await prisma.vendedorPendencia.upsert({
    where: { userId_businessId: { userId, businessId } },
    create: { userId, businessId, ...dados },
    update: dados,
  });
}

async function apagarPendencia(userId: string, businessId: string): Promise<void> {
  await prisma.vendedorPendencia.deleteMany({ where: { userId, businessId } });
}

// ── Lembrete de retorno (dias 2, 5 e 10) ───────────────────────────────────

/** Texto do lembrete: diz QUEM é e pede o desfecho nas três palavras que o
 *  fluxo de cima entende de volta. */
export function textoDoLembrete(lead: { nome: string | null; leadPhone: string; resumo: string | null }): string {
  const detalhe = detalheDoResumo(lead.resumo);
  return `Lead ${comoChamarOLead(lead)}${detalhe} segue em aberto. Fechou, perdeu ou em negociação?`;
}

/** PURA. Dois dados do resumo, entre parênteses — o vendedor reconhece o lead
 *  por eles ("empresa, 3 vidas"). Resumo vazio → sem parênteses. */
export function detalheDoResumo(resumo: string | null | undefined): string {
  if (!resumo) return '';
  const partes: string[] = [];
  for (const linha of String(resumo).split('\n')) {
    const m = linha.match(/^(Tipo|Pessoas|Idades):\s*(.+)$/);
    if (!m) continue;
    const valor = m[2].trim();
    if (!valor || valor === 'não respondeu') continue;
    if (m[1] === 'Tipo') partes.push(valor.startsWith('Empresa') ? 'empresa' : 'pessoa física');
    if (m[1] === 'Pessoas') partes.push(`${valor} vidas`);
  }
  return partes.length ? ` (${partes.slice(0, 2).join(', ')})` : '';
}

/**
 * Varre todos os negócios e manda os lembretes devidos. Chamado pelo cron de
 * hora em hora (ver index.ts).
 *
 * Respeita o horário de atendimento da config e NUNCA toca em conversa de
 * ensaio. Não fala com o lead em nenhuma hipótese — só com o vendedor.
 */
export async function enviarLembretesPendentes(agora = new Date()): Promise<number> {
  const candidatas = await prisma.whatsappConversation.findMany({
    where: {
      state: 'handoff',
      label: 'QUENTE',
      // Mesmo cuidado do registro da venda: lead em aberto tem `resultado`
      // NULO, e NULL nunca satisfaz uma comparação de desigualdade.
      OR: [{ resultado: null }, { resultado: { notIn: ['venda', 'perdido'] } }],
      handoffEm: { not: null },
      lembretesEnviados: { lt: 3 },
      NOT: { leadPhone: { startsWith: PREFIXO_ENSAIO } },
    },
    select: {
      id: true, userId: true, businessId: true, leadPhone: true, leadNome: true,
      summary: true, state: true, label: true, resultado: true, handoffEm: true,
      lembretesEnviados: true,
    },
    take: 500,
  });
  if (!candidatas.length) return 0;

  // Uma config por negócio, não por conversa.
  const configs = new Map<string, { handoffContact: string | null; businessHours: string | null; enabled: boolean; transport: string; transportConfig: unknown } | null>();
  let enviados = 0;

  for (const c of candidatas) {
    if (c.resultado === 'perdido') continue; // defensivo: `not: 'venda'` deixa passar
    const devido = lembreteDevido(
      { state: c.state, label: c.label, resultado: c.resultado, handoffEm: c.handoffEm, lembretesEnviados: c.lembretesEnviados },
      agora,
    );
    if (!devido) continue;

    const chave = `${c.userId}:${c.businessId}`;
    if (!configs.has(chave)) {
      configs.set(chave, await prisma.whatsappConfig.findUnique({
        where: { userId_businessId: { userId: c.userId, businessId: c.businessId } },
        select: { handoffContact: true, businessHours: true, enabled: true, transport: true, transportConfig: true },
      }));
    }
    const config = configs.get(chave);
    if (!config || !config.enabled || !config.handoffContact) continue;
    if (!dentroDoAtendimento(config.businessHours, agora)) continue;

    // Reclama o lembrete ANTES de enviar: se o envio falhar, o próximo ciclo
    // não repete em loop. Perder um lembrete é melhor que metralhar o vendedor.
    const ganhou = await prisma.whatsappConversation.updateMany({
      where: { id: c.id, lembretesEnviados: c.lembretesEnviados },
      data: { lembretesEnviados: devido, ultimoLembreteEm: agora },
    });
    if (ganhou.count !== 1) continue;

    const transport = resolveTransport(config.transport, (config.transportConfig ?? {}) as Record<string, unknown>);
    await transport.sendText(
      config.handoffContact,
      textoDoLembrete({ nome: c.leadNome, leadPhone: c.leadPhone, resumo: c.summary }),
    ).catch((e) => console.error('[whatsapp:lembrete] falha ao enviar ao vendedor:', e));
    enviados++;
    console.log(`[whatsapp:lembrete] ${devido}º lembrete enviado (lead ${c.leadPhone}, userId ${c.userId}, negócio ${c.businessId})`);
  }
  return enviados;
}
