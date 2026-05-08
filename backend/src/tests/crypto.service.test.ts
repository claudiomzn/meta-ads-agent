import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../services/crypto.service.js';

describe('CryptoService', () => {
  it('criptografa e descriptografa corretamente', () => {
    const original = 'EAABwzLixnjYBAtoken123456789';
    const cipher = encrypt(original);
    expect(cipher).not.toBe(original);
    expect(decrypt(cipher)).toBe(original);
  });

  it('produz cifras diferentes para o mesmo texto (IV aleatório)', () => {
    const text = 'mesmo-token';
    const c1 = encrypt(text);
    const c2 = encrypt(text);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(text);
    expect(decrypt(c2)).toBe(text);
  });

  it('não corrompe tokens com caracteres especiais', () => {
    const token = 'EAABwz+/=special&chars%20token';
    expect(decrypt(encrypt(token))).toBe(token);
  });
});
