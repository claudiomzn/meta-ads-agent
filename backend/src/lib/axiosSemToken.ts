// Tira o access_token de todo erro do axios antes que alguém o registre.
//
// Por quê (varredura de 10/11/2026): os serviços da Graph API (MetaGraph,
// Instagram, Pixel, CAPI, adAccount) mandam o token do cliente em
// `params: { access_token }`. Quando a chamada falha, o AxiosError carrega o
// token em `config.params`, em `config.url` e na URL da requisição
// (`request.path`). Um `console.error('...', error)` — e há dezenas — imprime
// tudo isso no log do Render, que o CLAUDE.md já aponta como caminho de
// vazamento de token de cliente.
//
// Em vez de caçar cada console.error, o interceptor limpa o erro na origem:
// qualquer erro do axios sai daqui sem o token. Instalado uma vez, no boot
// (index.ts), na instância padrão — a que os serviços usam.
import axios, { type AxiosError, type AxiosInstance } from 'axios';

const OCULTO = '[oculto]';
const NOMES_SECRETOS = ['access_token', 'input_token', 'client_secret', 'appsecret_proof', 'fb_exchange_token'];

/** Troca o valor de parâmetros secretos numa URL (absoluta ou só caminho). */
export function urlSemToken(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    new RegExp(`([?&](?:${NOMES_SECRETOS.join('|')})=)[^&#\\s]*`, 'gi'),
    `$1${OCULTO}`,
  );
}

function paramsSemToken(params: unknown): unknown {
  if (!params || typeof params !== 'object') return params;
  const copia: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  for (const nome of NOMES_SECRETOS) if (nome in copia) copia[nome] = OCULTO;
  return copia;
}

/** Limpa o erro no lugar. Exportado para teste. */
export function limparErroAxios(err: AxiosError): AxiosError {
  if (err.config) {
    err.config.params = paramsSemToken(err.config.params);
    err.config.url = urlSemToken(err.config.url);
    // Authorization (Bearer) e access_token no cabeçalho (chave do Asaas).
    const headers = err.config.headers as Record<string, unknown> | undefined;
    if (headers) {
      for (const nome of ['Authorization', 'authorization', 'access_token']) {
        if (nome in headers) headers[nome] = OCULTO;
      }
    }
  }
  // O ClientRequest guarda a URL já montada, com a query — e não serve para
  // nada depois do erro. Sai inteiro.
  (err as { request?: unknown }).request = undefined;
  if (err.response) {
    (err.response as { request?: unknown }).request = undefined;
    err.response.config = err.config as typeof err.response.config;
  }
  if (err.message) err.message = urlSemToken(err.message) ?? err.message;
  return err;
}

let instalado = false;

/** Instala na instância padrão do axios (idempotente). */
export function instalarAxiosSemToken(instancia: AxiosInstance = axios): void {
  if (instancia === axios && instalado) return;
  instancia.interceptors.response.use(undefined, (err: unknown) => {
    if (axios.isAxiosError(err)) limparErroAxios(err);
    return Promise.reject(err);
  });
  if (instancia === axios) instalado = true;
}
