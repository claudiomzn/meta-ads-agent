import { describe, expect, it } from 'vitest';
import { assertSafeImageUrl } from './safe-image-url.service.js';

describe('assertSafeImageUrl', () => {
  it('rejeita protocolos sem TLS', async () => {
    await expect(assertSafeImageUrl('http://fal.media/image.png'))
      .rejects.toThrow('Origem da imagem não permitida');
  });

  it('rejeita hosts fora da allowlist', async () => {
    await expect(assertSafeImageUrl('https://127.0.0.1/admin'))
      .rejects.toThrow('Origem da imagem não permitida');
    await expect(assertSafeImageUrl('https://example.com/image.png'))
      .rejects.toThrow('Origem da imagem não permitida');
  });

  it('rejeita credenciais embutidas na URL', async () => {
    await expect(assertSafeImageUrl('https://user:pass@fal.media/image.png'))
      .rejects.toThrow('Origem da imagem não permitida');
  });
});
