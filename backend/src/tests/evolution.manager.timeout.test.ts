// Trava a regressão de 15/09/2026: o timeout de 15s adicionado a
// getConnectionState (pra /evolution/status não travar a tela) também
// passou a valer DENTRO de connectInstance — e falhava com "aborted due to
// timeout" bem na hora em que a Evolution está acordando de hibernar, que é
// exatamente quando conectar precisa de MAIS tempo, não menos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.EVOLUTION_URL = 'https://evolution-api-test.example.com';
process.env.EVOLUTION_API_KEY = 'chave-teste';

import { connectInstance, getConnectionState } from '../services/whatsapp/evolution.manager.js';

describe('getConnectionState — timeout configurável, 15s por padrão', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ instance: { state: 'open' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
  });
  afterEach(() => vi.restoreAllMocks());

  it('polling de status (sem 3º argumento) usa 15s — falha rápido é o certo em background', async () => {
    await getConnectionState('user-1', 'default');
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it('aceita um timeout explícito maior', async () => {
    await getConnectionState('user-1', 'default', 45_000);
    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });
});

describe('connectInstance — usa um timeout maior que o do polling de status', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/instance/create')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ qrcode: { base64: 'data:...', pairingCode: '123456' } }) });
      }
      if (url.includes('/webhook/set/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      if (url.includes('/instance/connectionState/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ instance: { state: 'connecting' } }) });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('a chamada de connectionState dentro do fluxo de conectar pede 45s, não 15s', async () => {
    await connectInstance('user-1', 'default');
    // getConnectionState é chamado internamente pelo passo 3 de connectInstance.
    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(timeoutSpy).not.toHaveBeenCalledWith(15_000);
  });

  it('já conectado (state "open"): retorna sem pedir QR novo', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/instance/create')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      if (url.includes('/webhook/set/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      if (url.includes('/instance/connectionState/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ instance: { state: 'open' } }) });
      throw new Error(`fetch inesperado: ${url}`);
    });
    const r = await connectInstance('user-1', 'default');
    expect(r).toEqual({ qrBase64: null, pairingCode: null, state: 'open' });
  });
});
