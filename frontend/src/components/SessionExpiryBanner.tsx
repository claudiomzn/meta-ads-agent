import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useAuth, msUntilExpiry } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

// Mostra um banner amarelo quando a sessão estiver a menos de 1h de expirar.
// Some automaticamente após o refresh ou quando o usuário fechar.
export function SessionExpiryBanner() {
  const { refreshToken } = useAuth();
  const [visible, setVisible] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);

  const WARNING_MS = 60 * 60 * 1000; // 1 hora

  useEffect(() => {
    function check() {
      const token = localStorage.getItem('token');
      if (!token) return;

      const ms = msUntilExpiry(token);
      const mins = Math.floor(ms / 60_000);

      if (ms > 0 && ms <= WARNING_MS) {
        setMinutesLeft(mins);
        setVisible(true);
      } else {
        setVisible(false);
      }
    }

    check(); // checa imediatamente ao montar
    const interval = setInterval(check, 60_000); // roda a cada minuto
    return () => clearInterval(interval);
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshToken();
      setRefreshed(true);
      setTimeout(() => setVisible(false), 2000); // some após 2s de confirmação
    } catch {
      // erro silencioso — o usuário vai tentar de novo
    } finally {
      setRefreshing(false);
    }
  }

  if (!visible) return null;

  return (
    <div className={cn(
      'fixed bottom-4 right-4 z-50 flex items-start gap-3 rounded-xl border shadow-lg px-4 py-3 text-sm max-w-sm',
      refreshed
        ? 'bg-green-50 border-green-200 text-green-800'
        : 'bg-yellow-50 border-yellow-300 text-yellow-900',
    )}>
      {refreshed ? (
        <>
          <RefreshCw className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-600" />
          <p className="font-medium">Sessão renovada! Mais 7 dias.</p>
        </>
      ) : (
        <>
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Sessão expira em {minutesLeft} min</p>
            <p className="text-xs text-yellow-700 mt-0.5">Renove agora para não perder o acesso.</p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 px-3 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-60"
            >
              {refreshing
                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Renovando...</>
                : <><RefreshCw className="h-3 w-3" /> Renovar sessão</>
              }
            </button>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="text-yellow-600 hover:text-yellow-800 ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
