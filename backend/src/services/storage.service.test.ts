import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshStoredMediaUrl, storeUploadedMedia } from './storage.service.js';

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('storeUploadedMedia', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('grava no bucket privado e devolve uma URL assinada', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedURL: '/object/sign/meta-media/user/meta-media/file.png?token=signed',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await storeUploadedMedia(
      Buffer.from([137, 80, 78, 71]),
      'image/png',
      'criativo.png',
      'user-1',
    );

    expect(result).toBe(
      'https://project.supabase.co/storage/v1/object/sign/meta-media/user/meta-media/file.png?token=signed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/storage/v1/object/meta-media/user-1/meta-media/');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/storage/v1/object/sign/meta-media/user-1/meta-media/');
  });

  it('não devolve URL quando o bucket rejeita o upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Bucket not found', { status: 404 }),
    ));

    await expect(storeUploadedMedia(
      Buffer.from('imagem'),
      'image/png',
      'criativo.png',
      'user-1',
    )).rejects.toThrow('Não foi possível armazenar a mídia.');
  });

  it('renova a assinatura de um upload privado antes da publicação', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedURL: '/object/sign/meta-media/user/meta-media/file.png?token=new-token',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshStoredMediaUrl(
      'https://project.supabase.co/storage/v1/object/sign/meta-media/user/meta-media/file.png?token=expired',
    );

    expect(result).toContain('token=new-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não altera URLs que não pertencem ao bucket privado', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.com/creative.png';
    await expect(refreshStoredMediaUrl(url)).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
