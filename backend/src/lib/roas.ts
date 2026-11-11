// ROAS não julga conta de lead.
//
// O `metaRoas` vem do `purchase_roas` da Meta, que só existe quando a conta
// manda VALOR de compra (pixel/CAPI com `value`). Em campanha de lead e de
// WhatsApp — quase todo cliente do AdsGenius — ele é sempre 0. Isso não é
// prejuízo, é ausência de valor cadastrado. Tratar 0 como "retorno de R$ 0"
// gerou proposta de pausar a MELHOR campanha do cliente, com botão de 1 clique.
//
// Por isso: ROAS só entra em proposta, alerta, nota ou prompt quando a
// campanha tem valor de conversão real, ou seja, `metaRoas > 0`. Não existe
// campo de receita no schema; o próprio ROAS positivo é a prova de que houve
// valor de compra medido.
export function temValorDeConversao(roas: number | null | undefined): roas is number {
  return typeof roas === 'number' && Number.isFinite(roas) && roas > 0;
}

// O que mostrar à IA no lugar do número quando não há valor. Um `0` cru no
// JSON do prompt é lido como "retorno zero" — a frase deixa explícito.
export const ROAS_SEM_VALOR = 'sem valor de conversão (lead/WhatsApp) — não julgar por ROAS';

export function roasParaIA(roas: number | null | undefined): number | string {
  return temValorDeConversao(roas) ? roas : ROAS_SEM_VALOR;
}

// Regra para colar em todo prompt que recebe ROAS. Está aqui, num lugar só,
// porque regra que mora em uma porta e é esquecida nas outras já deixou
// passar o que deveria barrar.
export const REGRA_ROAS_PROMPT =
  'ROAS só vale para campanha com valor de conversão cadastrado. Campanha de lead ou WhatsApp tem ROAS 0 ' +
  `(ou "${ROAS_SEM_VALOR}") porque a Meta não recebe valor de venda — isso NÃO é prejuízo e NÃO é motivo ` +
  'para pausar nem para alerta crítico. Nesses casos, julgue por CPL, CTR, custo por conversa e frequência.';
