import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

// Decodifica o payload do JWT sem biblioteca (não valida assinatura — só lê o exp)
function decodeJwt(token: string): { exp: number; userId: string } | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// Retorna quantos ms faltam para o token expirar (negativo = já expirou)
export function msUntilExpiry(token: string): number {
  const payload = decodeJwt(token);
  if (!payload?.exp) return -1;
  return payload.exp * 1000 - Date.now();
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Verifica o token salvo no mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    api.get<User>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  // Auto-refresh silencioso: renova o token quando restar menos de 24h
  useEffect(() => {
    if (!user) return;

    function scheduleRefresh() {
      const token = localStorage.getItem('token');
      if (!token) return;

      const ms = msUntilExpiry(token);
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (ms <= 0) return; // já expirou — o middleware de auth vai cuidar

      // Quanto tempo esperar antes de renovar: quando sobrar 1 dia
      const waitMs = Math.max(ms - oneDayMs, 0);

      const timer = setTimeout(async () => {
        try {
          const res = await api.post<{ token: string; user: User }>('/auth/refresh');
          localStorage.setItem('token', res.token);
          setUser(res.user);
          scheduleRefresh(); // agenda o próximo ciclo (novo token = novos 7 dias)
        } catch {
          // Se o refresh falhar, deixa o token expirar naturalmente
        }
      }, waitMs);

      return timer;
    }

    const timer = scheduleRefresh();
    return () => { if (timer) clearTimeout(timer); };
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    localStorage.setItem('token', res.token);
    setUser(res.user);
    return res;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', { name, email, password });
    localStorage.setItem('token', res.token);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  // Renova manualmente (chamado pelo banner de aviso)
  const refreshToken = useCallback(async () => {
    const res = await api.post<{ token: string; user: User }>('/auth/refresh');
    localStorage.setItem('token', res.token);
    setUser(res.user);
  }, []);

  return { user, loading, login, register, logout, refreshToken };
}
