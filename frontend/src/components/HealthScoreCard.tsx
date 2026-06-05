import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface HealthData {
  score: number | null;
  status: 'saudavel' | 'atencao' | 'critico' | 'sem_dados';
  breakdown: { label: string; score: number; max: number; tip: string }[];
  message?: string;
}

function ScoreRing({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <svg width={96} height={96} className="flex-shrink-0">
      <circle cx={48} cy={48} r={r} fill="none" stroke="#f3f4f6" strokeWidth={8} />
      <circle
        cx={48} cy={48} r={r} fill="none"
        stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={48} y={44} textAnchor="middle" fontSize={22} fontWeight={700} fill={color}>{score}</text>
      <text x={48} y={60} textAnchor="middle" fontSize={10} fill="#9ca3af">/ 100</text>
    </svg>
  );
}

const STATUS_LABEL = {
  saudavel: { label: '🟢 Conta saudável', color: 'text-green-600' },
  atencao:  { label: '🟡 Atenção necessária', color: 'text-yellow-600' },
  critico:  { label: '🔴 Ação urgente', color: 'text-red-600' },
  sem_dados: { label: '⚪ Sem dados ainda', color: 'text-gray-400' },
};

export function HealthScoreCard() {
  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ['health-score'],
    queryFn: () => api.get('/agent/health-score'),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white p-5 space-y-3 animate-pulse">
        <div className="h-4 w-32 bg-gray-100 rounded" />
        <div className="h-24 w-24 bg-gray-100 rounded-full mx-auto" />
      </div>
    );
  }

  if (!data || data.score === null) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">Saúde da conta</p>
        <p className="text-xs text-gray-400">Publique sua primeira campanha para ver a nota.</p>
      </div>
    );
  }

  const statusInfo = STATUS_LABEL[data.status];

  return (
    <div className="rounded-xl border bg-white p-5 space-y-4">
      <p className="text-sm font-semibold text-gray-700">Saúde da conta</p>

      <div className="flex items-center gap-4">
        <ScoreRing score={data.score} />
        <div className="min-w-0">
          <p className={cn('text-sm font-bold', statusInfo.color)}>{statusInfo.label}</p>
          <p className="text-xs text-gray-400 mt-1">Baseado em ROAS, CTR, frequência e diversificação</p>
        </div>
      </div>

      <div className="space-y-2">
        {data.breakdown.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-gray-600 truncate">{item.label}</span>
              <span className="text-xs font-semibold text-gray-700 ml-2 flex-shrink-0">
                {item.score}/{item.max}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700',
                  item.score / item.max >= 0.8 ? 'bg-green-400' :
                  item.score / item.max >= 0.5 ? 'bg-yellow-400' : 'bg-red-400',
                )}
                style={{ width: `${(item.score / item.max) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{item.tip}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
