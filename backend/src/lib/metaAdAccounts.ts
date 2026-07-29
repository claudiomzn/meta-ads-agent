// Prova de propriedade das contas de anúncio.
//
// No modelo pipeboard/zapier o segredo MCP é compartilhado entre todos os
// clientes, então ele não prova nada sobre quem é o dono de uma conta. A única
// prova aceitável é o token PESSOAL do usuário: se `me/adaccounts` devolve a
// conta com aquele token, a conta é dele.
//
// Esta lógica vive num módulo próprio (e não dentro da rota) para ser testável
// sem subir o Express. Antes ela tinha um atalho `if (NODE_ENV === 'test')` que
// devolvia uma conta fixa — com ele, nenhum teste exercitava a validação real.

const GRAPH_HOST = 'graph.facebook.com';
const FIRST_PAGE = `https://${GRAPH_HOST}/v23.0/me/adaccounts?fields=id&limit=100`;
const MAX_PAGES = 10;

/** Remove o prefixo `act_` para comparar ids de forma estável. */
export function normalizeAdAccountId(id: string): string {
  return String(id).trim().replace(/^act_/, '');
}

/**
 * Ids (sem `act_`) de todas as contas de anúncio que este token alcança.
 * Lança se o token for inválido ou a Graph API recusar a listagem — quem chama
 * deve tratar a exceção como "não foi possível provar a propriedade".
 */
export async function listTokenAdAccountIds(accessToken: string): Promise<Set<string>> {
  const allowed = new Set<string>();
  let next: string | null = FIRST_PAGE;

  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    // `paging.next` vem do corpo da resposta. Confirmar o host antes de seguir
    // evita que uma resposta inesperada nos faça requisitar outro destino.
    if (new URL(next).hostname !== GRAPH_HOST) {
      throw new Error('Resposta inesperada da Meta ao listar contas.');
    }

    const response = await fetch(next, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error('Token Meta inválido ou sem acesso às contas informadas.');
    }

    const payload = await response.json() as {
      data?: Array<{ id?: string }>;
      paging?: { next?: string };
    };
    for (const account of payload.data ?? []) {
      if (account.id) allowed.add(normalizeAdAccountId(account.id));
    }
    next = payload.paging?.next ?? null;
  }

  return allowed;
}

/**
 * Verdadeiro se TODAS as contas pedidas estiverem entre as alcançadas pelo
 * token. Lista vazia é falso: conectar sem conta nenhuma não é um caso válido.
 */
export function accountsBelongToToken(
  requested: string[],
  reachable: Set<string>,
): boolean {
  if (!requested.length) return false;
  return requested.every((id) => reachable.has(normalizeAdAccountId(id)));
}
