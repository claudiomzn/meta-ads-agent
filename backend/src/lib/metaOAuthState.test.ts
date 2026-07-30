import { describe, expect, it } from 'vitest';
import {
  createMetaOAuthState,
  META_OAUTH_COOKIE,
  verifyMetaOAuthState,
} from './metaOAuthState.js';

const SECRET = 'segredo-de-teste-com-tamanho-suficiente';

describe('Meta OAuth state', () => {
  it('aceita somente o navegador que recebeu o nonce', () => {
    const { state, nonce } = createMetaOAuthState('user-1', SECRET);
    const result = verifyMetaOAuthState(
      state,
      `outro=valor; ${META_OAUTH_COOKIE}=${nonce}`,
      SECRET,
    );
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('recusa state copiado para outro navegador', () => {
    const { state } = createMetaOAuthState('user-1', SECRET);
    expect(() =>
      verifyMetaOAuthState(
        state,
        `${META_OAUTH_COOKIE}=nonce-do-outro-navegador`,
        SECRET,
      ),
    ).toThrow(/OAuth inválido/);
  });

  it('recusa callback sem cookie', () => {
    const { state } = createMetaOAuthState('user-1', SECRET);
    expect(() => verifyMetaOAuthState(state, undefined, SECRET)).toThrow(/OAuth inválido/);
  });

  it('recusa state adulterado', () => {
    const { state, nonce } = createMetaOAuthState('user-1', SECRET);
    expect(() =>
      verifyMetaOAuthState(
        `${state}x`,
        `${META_OAUTH_COOKIE}=${nonce}`,
        SECRET,
      ),
    ).toThrow();
  });
});
