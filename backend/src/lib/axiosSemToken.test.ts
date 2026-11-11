// O token do cliente não pode sair num erro do axios (varredura de 10/11/2026).
// Requisição REAL a um servidor local que responde 400 — o mesmo caminho de
// um token vencido na Graph API —, e o erro inspecionado como o console.error
// o imprime no log do Render.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { inspect } from 'node:util';
import axios, { type AxiosInstance } from 'axios';
import { instalarAxiosSemToken, urlSemToken } from './axiosSemToken.js';

const SEGREDO = 'EAAGtokenSecretoDoCliente123';
let servidor: http.Server;
let base = '';

beforeAll(async () => {
  servidor = http.createServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Error validating access token', code: 190 } }));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
  const porta = (servidor.address() as { port: number }).port;
  base = `http://127.0.0.1:${porta}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

async function erroDe(instancia: AxiosInstance, config: Parameters<AxiosInstance['get']>[1], url = `${base}/v24/me/accounts`) {
  try {
    await instancia.get(url, config);
  } catch (err) {
    return err;
  }
  throw new Error('deveria ter falhado');
}

describe('instalarAxiosSemToken', () => {
  it('⭐ sem o interceptor, o token aparece no erro (prova de que o teste enxerga o vazamento)', async () => {
    const crua = axios.create();
    const err = await erroDe(crua, { params: { access_token: SEGREDO, fields: 'id' } });
    expect(inspect(err, { depth: 6 })).toContain(SEGREDO);
  });

  it('⭐ com o interceptor, o erro inteiro sai sem o token (params, url e request)', async () => {
    const limpa = axios.create();
    instalarAxiosSemToken(limpa);
    const err = await erroDe(limpa, { params: { access_token: SEGREDO, fields: 'id' } });
    const texto = inspect(err, { depth: 8 }) + JSON.stringify((err as { toJSON?: () => unknown }).toJSON?.() ?? {});
    expect(texto).not.toContain(SEGREDO);
    // o que ajuda a depurar continua lá
    expect(texto).toContain('400');
    expect(texto).toContain('Error validating access token');
  });

  it('token na própria URL também sai', async () => {
    const limpa = axios.create();
    instalarAxiosSemToken(limpa);
    const err = await erroDe(limpa, {}, `${base}/v24/me?access_token=${SEGREDO}&fields=id`);
    expect(inspect(err, { depth: 8 })).not.toContain(SEGREDO);
  });

  it('chave no cabeçalho (Asaas) também sai', async () => {
    const limpa = axios.create({ headers: { access_token: SEGREDO } });
    instalarAxiosSemToken(limpa);
    const err = await erroDe(limpa, {});
    expect(inspect(err, { depth: 8 })).not.toContain(SEGREDO);
  });
});

describe('urlSemToken', () => {
  it('troca só o valor dos parâmetros secretos', () => {
    expect(urlSemToken(`/x?fields=id&access_token=${SEGREDO}&limit=5`)).toBe('/x?fields=id&access_token=[oculto]&limit=5');
    expect(urlSemToken('/x?fields=id')).toBe('/x?fields=id');
  });
});
