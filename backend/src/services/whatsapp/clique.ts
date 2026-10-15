// O clique do anúncio que o site registrou para uma conversa.
//
// Em arquivo próprio (12/10/2026) porque dois fluxos precisam dele — o lead
// QUENTE (whatsapp.service.ts) e a venda informada pelo vendedor
// (resultado.service.ts) — e um import entre os dois faria ciclo.

import prisma from '../../lib/prisma.js';

/**
 * gclid/gbraid/wbraid do clique que o site registrou para esta conversa.
 * Vazio quando a conversa não veio do site com código de clique (ou o
 * registro não chegou): aí a conversão sobe só pelo telefone, como antes.
 */
export async function cliqueDaConversa(convId: string): Promise<{ gclid?: string; gbraid?: string; wbraid?: string }> {
  const conv = await prisma.whatsappConversation.findUnique({ where: { id: convId }, select: { origemClique: true } });
  if (!conv?.origemClique) return {};
  const c = await prisma.cliqueDoSite.findUnique({ where: { codigo: conv.origemClique } });
  if (!c) return {};
  return {
    ...(c.gclid ? { gclid: c.gclid } : {}),
    ...(c.gbraid ? { gbraid: c.gbraid } : {}),
    ...(c.wbraid ? { wbraid: c.wbraid } : {}),
  };
}
