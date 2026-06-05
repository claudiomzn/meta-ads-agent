import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { X, Loader2, Zap } from 'lucide-react';

interface AlertAction {
  label: string;
  method: 'POST' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
}

interface ProactiveAlert {
  id: string;
  type: 'critical' | 'warning' | 'opportunity' | 'info';
  emoji: string;
  message: string;
  detail?: string;
  campaignId?: string | null;
  action?: AlertAction | null;
}

interface AlertsData {
  alerts: ProactiveAlert[];
}

const TYPE_STYLES = {
  critical:    'border-red-200 bg-red-50',
  warning:     'border-yellow-200 bg-yellow-50',
  opportunity: 'border-green-200 bg-green-50',
  info:        'border-blue-200 bg-blue-50',
};

const BTN_STYLES = {
  critical:    'bg-red-600 hover:bg-red-700 text-white',
  warning:     'bg-yellow-600 hover:bg-yellow-700 text-white',
  opportunity: 'bg-green-600 hover:bg-green-700 text-white',
  info:        'bg-blue-600 hover:bg-blue-700 text-white',
};

export function ProactiveAlerts() {
  const queryClient = useQueryClient();

  // IDs dos alertas já descartados nesta sessão
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('dismissedAlerts');
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  // Quais alertas estão com ação em andamento
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  // Quais tiveram ação concluída com sucesso
  const [done, setDone] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<AlertsData>({
    queryKey: ['proactive-alerts'],
    queryFn: () => api.get('/agent/proactive-alerts'),
    staleTime: 15 * 60_000, // 15 min — não chama Claude toda vez
    retry: 1,
  });

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem('dismissedAlerts', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  async function execute(alert: ProactiveAlert) {
    if (!alert.action) return;
    setExecuting((prev) => new Set(prev).add(alert.id));
    try {
      const { method, path, body } = alert.action;
      if (method === 'POST') await api.post(path, body);
      else await api.patch(path, body);

      setDone((prev) => new Set(prev).add(alert.id));
      // Invalida queries relacionadas para refletir a mudança
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['proactive-alerts'] });

      // Auto-descarta após 3s
      setTimeout(() => dismiss(alert.id), 3000);
    } catch (err) {
      console.error('[ProactiveAlerts] Falha na ação:', err);
    } finally {
      setExecuting((prev) => { const s = new Set(prev); s.delete(alert.id); return s; });
    }
  }

  if (isLoading) return null; // silencioso durante carregamento

  const visible = (data?.alerts ?? []).filter(
    (a) => !dismissed.has(a.id) && !done.has(a.id),
  );

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Label sutil */}
      <div className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-[#1877F2]" />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Agente detectou {visible.length === 1 ? '1 ponto de atenção' : `${visible.length} pontos de atenção`}
        </span>
      </div>

      {visible.map((alert) => {
        const isRunning = executing.has(alert.id);
        const isDone    = done.has(alert.id);

        return (
          <div
            key={alert.id}
            className={cn(
              'relative flex items-start gap-3 rounded-xl border px-4 py-3 transition-all',
              TYPE_STYLES[alert.type],
            )}
          >
            {/* Emoji */}
            <span className="text-xl flex-shrink-0 mt-0.5">{alert.emoji}</span>

            {/* Texto */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{alert.message}</p>
              {alert.detail && (
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{alert.detail}</p>
              )}

              {/* Botão de ação */}
              {alert.action && !isDone && (
                <button
                  onClick={() => execute(alert)}
                  disabled={isRunning}
                  className={cn(
                    'mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                    BTN_STYLES[alert.type],
                    isRunning && 'opacity-70 cursor-not-allowed',
                  )}
                >
                  {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isRunning ? 'Aplicando...' : alert.action.label}
                </button>
              )}

              {isDone && (
                <p className="mt-2 text-xs font-semibold text-green-600">✅ Feito!</p>
              )}
            </div>

            {/* Fechar */}
            <button
              onClick={() => dismiss(alert.id)}
              className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
              title="Dispensar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
