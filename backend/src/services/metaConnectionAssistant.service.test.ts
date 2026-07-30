import { describe, expect, it } from 'vitest';
import { containsLikelySecret } from './metaConnectionAssistant.service.js';

describe('containsLikelySecret', () => {
  it('bloqueia token Meta com prefixo EAA', () => {
    expect(containsLikelySecret(`meu token é EAA${'a'.repeat(40)}`)).toBe(true);
  });

  it('bloqueia credencial longa mesmo sem prefixo conhecido', () => {
    expect(containsLikelySecret('x'.repeat(100))).toBe(true);
  });

  it('permite perguntas e IDs de conta', () => {
    expect(containsLikelySecret('Onde encontro a conta 123456789012345?')).toBe(false);
  });
});
