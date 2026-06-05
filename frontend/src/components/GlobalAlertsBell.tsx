import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X, Loader2, Zap } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface AlertAction {
  label: string;
  method: 'POST' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
}

export interface ProactiveAlert {
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
  info:        'bg-[#1877F2] hover:bg-[#1565c0] text-white',
};

const BADGE_COLOR = {
  critical:    'bg-red-500',
  warning:     'bg-yellow-500',
  opportunity: 'bg-green-500',
  info:        'bg-blue-500',
};

function getDismissed(): Set<string> {
  try {
    const saved = sessionStorage.getItem('dismissedAlerts');
    return new Set(saved ? JSON.parse(saved) : []);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  try { sessionStorage.setItem('dismissedAlerts', JSON.stringify([...set])); } catch {}
}

export function GlobalAlertsBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

  const { data } = useQuery<AlertsData>({
    queryKey: ['proactive-alerts'],
    queryFn: () => api.get('/agent/proactive-alerts'),
    staleTime: 15 * 60_000,
    retry: 1,
  });

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onMousedown(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current   && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', onMousedown);
    return () => document.removeEventListener('mousedown', onMousedown);
  }, [open]);

  // Fecha com Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const visible = (data?.alerts ?? []).filter(
    (a) => !dismissed.has(a.id) && !done.has(a.id),
  );

  // Cor do badge = tipo mais grave
  const badgeColor = visible.find((a) => a.type === 'critical')  ? BADGE_COLOR.critical
    : visible.find((a) => a.type === 'warning')                  ? BADGE_COLOR.warning
    : visible.find((a) => a.type === 'opportunity')              ? BADGE_COLOR.opportunity
    : BADGE_COLOR.info;

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(id);
      saveDismissed(next);
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
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['proactive-alerts'] });
      setTimeout(() => dismiss(alert.id), 2500);
    } catch (err) {
      console.error('[GlobalAlerts] Falha na ação:', err);
    } finally {
      setExecuting((prev) => { const s = new Set(prev); s.delete(alert.id); return s; });
    }
  }

  return (
    <div className="relative">
      {/* Botão sino */}
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'relative rounded-lg p-2 transition-colors',
          open ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        )}
        aria-label="Alertas do agente"
      >
        <Bell className="h-5 w-5" />
        {visible.length > 0 && (
          <span className={cn(
            'absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white',
            badgeColor,
          )}>
            {visible.length}
          </span>
        )}
      </button>

      {/* Painel dropdown */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border bg-white shadow-xl z-50 overflow-hidden"
        >
          {/* Header do painel */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#1877F2]" />
              <span className="text-sm font-semibold text-gray-800">Agente IA</span>
              {visible.length > 0 && (
                <span className="text-xs text-gray-400">
                  {visible.length} alerta{visible.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Lista de alertas */}
          <div className="max-h-[420px] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-sm font-medium text-gray-700">Tudo certo por aqui</p>
                <p className="text-xs text-gray-400 mt-1">
                  O agente não identificou nenhum ponto de atenção no momento.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {visible.map((alert) => {
                  const isRunning = executing.has(alert.id);
                  const isDone    = done.has(alert.id);

                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        'relative rounded-xl border p-3 transition-all',
                        TYPE_STYLES[alert.type as keyof typeof TYPE_STYLES] ?? TYPE_STYLES.info,
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl flex-shrink-0 mt-0.5">{alert.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 leading-snug">
                            {alert.message}
                          </p>
                          {alert.detail && (
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                              {alert.detail}
                            </p>
                          )}

                          {alert.action && !isDone && (
                            <button
                              onClick={() => execute(alert)}
                              disabled={isRunning}
                              className={cn(
                                'mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                                BTN_STYLES[alert.type as keyof typeof BTN_STYLES] ?? BTN_STYLES.info,
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

                        <button
                          onClick={() => dismiss(alert.id)}
                          className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600"
                          title="Dispensar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t bg-gray-50">
            <p className="text-[10px] text-gray-400 text-center">
              Powered by Claude · atualiza a cada 15 min
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
