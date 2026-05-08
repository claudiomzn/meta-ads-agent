import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setUnauthorizedHandler } from '@/services/api';

function mockFetch(status: number, body: unknown) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
  });
}

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('faz GET com Content-Type correto', async () => {
    mockFetch(200, { id: '1' });
    const result = await api.get<{ id: string }>('/test');
    expect(result.id).toBe('1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('inclui Authorization quando há token', async () => {
    localStorage.setItem('token', 'test-jwt-token');
    mockFetch(200, {});
    await api.get('/protected');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/protected',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt-token' }),
      }),
    );
  });

  it('chama onUnauthorized e lança erro no 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: 'Unauthorized' });

    await expect(api.get('/private')).rejects.toThrow('Sessão expirada');
    expect(handler).toHaveBeenCalledOnce();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('lança erro com mensagem do servidor em falhas 4xx', async () => {
    mockFetch(400, { error: 'Campo obrigatório ausente' });
    await expect(api.post('/resource', {})).rejects.toThrow('Campo obrigatório ausente');
  });

  it('retorna undefined em resposta 204', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => { throw new Error('no body'); },
    });
    const result = await api.delete('/resource/1');
    expect(result).toBeUndefined();
  });
});
