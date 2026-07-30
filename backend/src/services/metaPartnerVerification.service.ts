import prisma from '../lib/prisma.js';
import { accountsBelongToToken, listTokenAdAccountIds } from '../lib/metaAdAccounts.js';

export type PartnerVerificationResult =
  | { state: 'verified'; verifiedAt: Date }
  | { state: 'not_visible' }
  | { state: 'unavailable' }
  | { state: 'not_pending' };

const MIN_RECHECK_MS = 30_000;

/**
 * Confere apenas se a credencial de onboarding do AdsGenius enxerga a conta
 * exata pedida. Essa credencial nunca é usada como conexão operacional de um
 * cliente, nunca é devolvida e a lista de contas alcançadas não sai daqui.
 */
export async function verifyPartnerAccessForRequest(
  requestId: string,
): Promise<PartnerVerificationResult> {
  const verifierToken = process.env.META_PARTNER_VERIFY_TOKEN;
  if (!verifierToken) return { state: 'unavailable' };

  const recheckBefore = new Date(Date.now() - MIN_RECHECK_MS);
  const claimed = await prisma.metaConnectionRequest.updateMany({
    where: {
      id: requestId,
      status: 'pending',
      OR: [
        { lastVerificationAt: null },
        { lastVerificationAt: { lte: recheckBefore } },
      ],
    },
    data: {
      lastVerificationAt: new Date(),
      verificationAttempts: { increment: 1 },
    },
  });
  if (!claimed.count) return { state: 'not_pending' };

  const connectionRequest = await prisma.metaConnectionRequest.findUnique({
    where: { id: requestId },
    select: { adAccountId: true, status: true },
  });
  if (!connectionRequest || connectionRequest.status !== 'pending') {
    return { state: 'not_pending' };
  }

  let reachable: Set<string>;
  try {
    reachable = await listTokenAdAccountIds(verifierToken);
  } catch (error) {
    console.error(
      '[meta:partner-verification] credencial de onboarding indisponível:',
      error instanceof Error ? error.message : 'erro desconhecido',
    );
    return { state: 'unavailable' };
  }

  if (!accountsBelongToToken([connectionRequest.adAccountId], reachable)) {
    return { state: 'not_visible' };
  }

  const verifiedAt = new Date();
  const advanced = await prisma.metaConnectionRequest.updateMany({
    where: { id: requestId, status: 'pending' },
    data: {
      status: 'configuring',
      partnerAccessVerifiedAt: verifiedAt,
      customerMessage: null,
    },
  });
  return advanced.count
    ? { state: 'verified', verifiedAt }
    : { state: 'not_pending' };
}

export async function verifyPendingMetaConnectionRequests(): Promise<void> {
  if (!process.env.META_PARTNER_VERIFY_TOKEN) return;

  const requests = await prisma.metaConnectionRequest.findMany({
    where: {
      status: 'pending',
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      OR: [
        { lastVerificationAt: null },
        { lastVerificationAt: { lte: new Date(Date.now() - 2 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const request of requests) {
    await verifyPartnerAccessForRequest(request.id);
  }
}

export function isExplicitMetaPermissionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /oauth(?:exception)?/i,
    /invalid.*access token/i,
    /access token.*(?:expired|invalid)/i,
    /permission.*(?:denied|missing|revoked)/i,
    /error code["': ]+(?:190|200)\b/i,
    /\(#(?:190|200)\)/i,
    /not authorized/i,
  ].some((pattern) => pattern.test(message));
}
