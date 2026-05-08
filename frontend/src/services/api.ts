// Em produção usa VITE_API_URL; em dev usa o proxy do Vite (/api)
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api';

export function getToken(): string | null {
  return localStorage.getItem('token');
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  attempt = 1,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  // Token expirado — limpa sessão e redireciona para login
  if (res.status === 401) {
    localStorage.removeItem('token');
    onUnauthorized?.();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  // Retry em erros de servidor (502/503/504) — até 3 tentativas
  if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    return request<T>(path, options, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const errValue = body.error;
    const errMessage =
      typeof errValue === 'string'
        ? errValue
        : errValue != null
        ? JSON.stringify(errValue)
        : `HTTP ${res.status}`;
    throw new Error(errMessage);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
