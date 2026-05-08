import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    api.get<User>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

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

  return { user, loading, login, register, logout };
}
