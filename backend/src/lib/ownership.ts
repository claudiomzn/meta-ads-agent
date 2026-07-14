import prisma from './prisma.js';

/**
 * Modelo pipeboard/zapier: TODOS os clientes compartilham um único token de
 * servidor pra falar com a Graph API. Sem essa checagem, qualquer usuário
 * autenticado poderia criar uma regra de automação (ou o cron poderia
 * executar uma já existente) apontando para o `targetId` (ID do Meta) de
 * uma campanha/conjunto/anúncio de OUTRO cliente — pausando ou alterando
 * orçamento de uma conta que não é dele.
 *
 * Verifica se o `targetId` (ID do Meta: metaCampaignId / metaAdSetId /
 * metaAdId) pertence a um registro local (Campaign/AdSet/Ad) cujo dono é
 * `userId`. Usada tanto na criação da regra (automations.routes.ts) quanto
 * de novo no cron antes de executar cada regra (defesa em profundidade —
 * cobre o caso de o item ter sido transferido/apagado depois de criada).
 */
export async function targetBelongsToUser(
  targetType: 'campaign' | 'adset' | 'ad',
  targetId: string,
  userId: string,
): Promise<boolean> {
  if (targetType === 'campaign') {
    const campaign = await prisma.campaign.findFirst({
      where: { metaCampaignId: targetId, userId },
      select: { id: true },
    });
    return !!campaign;
  }

  if (targetType === 'adset') {
    const adSet = await prisma.adSet.findFirst({
      where: { metaAdSetId: targetId, campaign: { userId } },
      select: { id: true },
    });
    return !!adSet;
  }

  // 'ad'
  const ad = await prisma.ad.findFirst({
    where: { metaAdId: targetId, adSet: { campaign: { userId } } },
    select: { id: true },
  });
  return !!ad;
}
