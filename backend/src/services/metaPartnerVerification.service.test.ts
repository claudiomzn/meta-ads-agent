import { describe, expect, it } from 'vitest';
import { isExplicitMetaPermissionFailure } from './metaPartnerVerification.service.js';

describe('isExplicitMetaPermissionFailure', () => {
  it('reconhece token expirado e permissão revogada', () => {
    expect(isExplicitMetaPermissionFailure(new Error('OAuthException: Error code 190'))).toBe(true);
    expect(isExplicitMetaPermissionFailure(new Error('Permission denied or revoked'))).toBe(true);
    expect(isExplicitMetaPermissionFailure(new Error('Access token expired'))).toBe(true);
  });

  it('não confunde indisponibilidade temporária com revogação', () => {
    expect(isExplicitMetaPermissionFailure(new Error('timeout ao consultar MCP'))).toBe(false);
    expect(isExplicitMetaPermissionFailure(new Error('503 service unavailable'))).toBe(false);
    expect(isExplicitMetaPermissionFailure(new Error('rate limit'))).toBe(false);
  });
});
