import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyAction {
  priority: 'urgente' | 'atencao' | 'ok' | 'dica';
  icon: string;
  title: string;
  description: string;
  link: string | null;
}

interface DailyActionsData {
  actions: DailyAction[];
}

const PRIORITY_STYLES = {
  urgente: { border: 'border-red-200',   bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',    dot: 'bg-red-400'    },
  atencao: { border: 'border-yellow-200', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-400' },
  ok:      { border: 'border-green-200', bg: 'bg-green-50',  badge: 'bg-green-100 text-green-700', dot: 'bg-green-400'  },
  dica:    { border: 'border-blue-200',  bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400'   },
};

const PRIORITY_LABEL = {
  urgente: 'Urgente',
  atencao: 'Atenção',
  ok:      'Positivo',
  dica:    'Dica',
};

export function DailyActionsPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<DailyActionsData>({
    queryKey: ['daily-actions'],
    queryFn: () => api.get('/agent/daily-actions'),
    staleTime: 30 * 60_000, // 30 min — não reconsulta o Claude a cada clique
    retry: 1,
  });

  return (
    <div className="rounded-xl border bg-white p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">☀️ O que fazer hoje</p>
          <p className="text-xs text-gray-400 mt-0.5">Ações práticas geradas pela IA com base nas suas campanhas</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-gray-400 hover:text-[#1877F2] flex items-center gap-1 transition-colors disabled:opacity-50"
          title="Atualizar ações"
        >
          <Loader2 className={cn('h-3 w-3', isFetching && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-50 animate-pulse" />
          ))}
        </div>
      )}

      {/* Actions */}
      {!isLoading && data?.actions.map((action, i) => {
        // Normaliza priority — a IA às vezes retorna valores fora do enum esperado
        const validPriority = (action.priority in PRIORITY_STYLES)
          ? action.priority as keyof typeof PRIORITY_STYLES
          : 'dica' as const;
        const style = PRIORITY_STYLES[validPriority];
        const content = (
          <div className={cn(
            'flex items-start gap-3 rounded-lg border p-3 transition-all',
            style.border, style.bg,
            action.link && 'cursor-pointer hover:shadow-sm',
          )}>
            <span className="text-xl flex-shrink-0 mt-0.5">{action.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-semibold text-gray-800 truncate">{action.title}</p>
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0', style.badge)}>
                  {PRIORITY_LABEL[validPriority]}
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{action.description}</p>
            </div>
            {action.link && (
              <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
            )}
          </div>
        );

        return action.link
          ? <Link key={i} to={action.link}>{content}</Link>
          : <div key={i}>{content}</div>;
      })}

      {!isLoading && (!data?.actions || data.actions.length === 0) && (
        <p className="text-sm text-gray-400 text-center py-4">Nenhuma ação no momento.</p>
      )}

      <p className="text-[10px] text-gray-300 text-right">
        Powered by Claude · atualiza a cada 30 min
      </p>
    </div>
  );
}
