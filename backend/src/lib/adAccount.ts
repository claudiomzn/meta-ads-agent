import axios from 'axios';
import prisma from './prisma.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Resolve a conta de anúncios (act_XXX) DO USUÁRIO — nunca "a primeira que o
// token enxerga".
//
// Dois problemas que este helper existe para evitar:
//
// 1. CROSS-TENANT: mesmo com um token individual, ele pode alcançar várias
//    contas. Resolver via `me/adaccounts` e pegar `accounts[0]` pode agir na
//    conta errada. A conta correta é a que o usuário vinculou em
//    mCPConnection.adAccountIds.
//
// 2. FORMATO: o frontend grava o id SEM o prefixo (`MetaConnect` faz
//    `.replace("act_", "")`), mas os endpoints de ad account da Graph API
//    exigem `act_<id>`. Usar o valor cru monta uma URL inválida.
//
// Quando o token de fato enxerga a conta do usuário, ela é confirmada contra
// `me/adaccounts`; se a listagem falhar (rede/permissão), seguimos com o id do
// usuário mesmo assim — é melhor que cair na conta de outra pessoa.
// TODAS as contas vinculadas pelo usuário, normalizadas com o prefixo `act_`.
// Base de resolveUserAdAccountId e de qualquer leitura que precise varrer as
// contas do próprio usuário — como listar as Páginas promovíveis.
export async function resolveUserAdAccountIds(userId: string): Promise<string[]> {
  const conn = await prisma.mCPConnection.findUnique({ where: { userId } });
  if (!conn?.adAccountIds) throw new Error('Nenhuma conta de anúncio vinculada.');

  let ids: string[] = [];
  try {
    ids = JSON.parse(conn.adAccountIds);
  } catch {
    throw new Error('Contas de anúncio vinculadas em formato inválido.');
  }
  const normalized = ids
    .map((id) => String(id).trim())
    .filter(Boolean)
    .map((id) => (id.startsWith('act_') ? id : `act_${id}`));
  if (!normalized.length) throw new Error('Nenhuma conta de anúncio vinculada.');

  return normalized;
}

export async function resolveUserAdAccountId(userId: string, token: string): Promise<string> {
  const normalized = await resolveUserAdAccountIds(userId);

  try {
    const res = await axios.get(`${GRAPH}/me/adaccounts`, {
      params: { fields: 'id', access_token: token },
    });
    const reachable = new Set<string>((res.data?.data ?? []).map((a: { id: string }) => a.id));
    const match = normalized.find((id) => reachable.has(id));
    if (match) return match;
    // O token não enxerga nenhuma das contas do usuário: seguir com a conta
    // dele e deixar a Graph API recusar é mais correto (e mais fácil de
    // diagnosticar) do que agir na conta de outro cliente.
  } catch {
    // Listagem indisponível — usa a conta vinculada do próprio usuário.
  }

  return normalized[0];
}
