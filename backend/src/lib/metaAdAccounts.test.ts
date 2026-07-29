import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  accountsBelongToToken,
  listTokenAdAccountIds,
  normalizeAdAccountId,
} from './metaAdAccounts.js';

// Estes testes exercitam a validação de propriedade DE VERDADE. A versão
// anterior desta lógica tinha um `if (NODE_ENV === 'test')` que devolvia uma
// conta fixa, então a suíte passava sem nunca testar a regra que impede um
// cliente de vincular a conta de anúncios de outro.

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeAdAccountId', () => {
  it('remove o prefixo act_ e espaços', () => {
    expect(normalizeAdAccountId('act_123')).toBe('123');
    expect(normalizeAdAccountId('  act_456 ')).toBe('456');
    expect(normalizeAdAccountId('789')).toBe('789');
  });
});

describe('listTokenAdAccountIds', () => {
  it('devolve os ids das contas alcançadas pelo token, sem prefixo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'act_111' }, { id: 'act_222' }] }),
    ));

    const ids = await listTokenAdAccountIds('token-do-usuario');

    expect([...ids].sort()).toEqual(['111', '222']);
  });

  it('manda o token no header Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await listTokenAdAccountIds('token-secreto');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-secreto');
  });

  it('acumula contas de todas as páginas', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'act_1' }],
        paging: { next: 'https://graph.facebook.com/v23.0/me/adaccounts?after=abc' },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'act_2' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const ids = await listTokenAdAccountIds('t');

    expect([...ids].sort()).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lança quando a Graph API recusa o token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)));

    await expect(listTokenAdAccountIds('token-ruim')).rejects.toThrow(/Token Meta inválido/);
  });

  it('não segue paginação para fora do host da Graph API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      data: [{ id: 'act_1' }],
      paging: { next: 'https://atacante.example.com/roubar' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listTokenAdAccountIds('t')).rejects.toThrow(/Resposta inesperada/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('accountsBelongToToken', () => {
  const reachable = new Set(['111', '222']);

  it('aceita quando todas as contas pedidas pertencem ao token', () => {
    expect(accountsBelongToToken(['act_111'], reachable)).toBe(true);
    expect(accountsBelongToToken(['111', 'act_222'], reachable)).toBe(true);
  });

  it('recusa quando alguma conta pedida não pertence ao token', () => {
    // O caso que a auditoria encontrou: cliente declarando a conta de outro.
    expect(accountsBelongToToken(['act_999'], reachable)).toBe(false);
    expect(accountsBelongToToken(['act_111', 'act_999'], reachable)).toBe(false);
  });

  it('recusa lista vazia', () => {
    expect(accountsBelongToToken([], reachable)).toBe(false);
  });

  it('recusa quando o token não alcança conta nenhuma', () => {
    expect(accountsBelongToToken(['act_111'], new Set())).toBe(false);
  });
});
