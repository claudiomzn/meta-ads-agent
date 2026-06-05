import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Palette, Trash2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/services/api';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface HistoryItem {
  id: string;
  fileName: string;
  fileType: string;
  overallScore: number;
  approvalRecommendation: string;
  summary: string;
  realCtr: number | null;
  realCpl: number | null;
  isComparison: boolean;
  campaignId: string | null;
  adId: string | null;
  createdAt: string;
}

interface HistoryResponse {
  items: HistoryItem[];
  total: number;
  page: number;
  totalPages: number;
}

function ApprovalBadge({ rec }: { rec: string }) {
  const map: Record<string, { label: string; className: string }> = {
    aprovado: { label: '✅ Aprovado', className: 'bg-green-100 text-green-700' },
    aprovar_com_ressalvas: { label: '⚠️ Com ressalvas', className: 'bg-yellow-100 text-yellow-700' },
    reprovar: { label: '❌ Reprovado', className: 'bg-red-100 text-red-700' },
  };
  const m = map[rec] ?? map.reprovar;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', m.className)}>{m.label}</span>;
}

function ScoreBadge({ score }: { score: number }) {
  const s = Number(score ?? 0);
  const color = s >= 7 ? 'bg-green-100 text-green-700' : s >= 4 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold', color)}>
      {s.toFixed(1)}
    </span>
  );
}

export default function CreativeHistoryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>('');

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['creative-history', page, filter],
    queryFn: () => api.get(`/creative-analysis?page=${page}&limit=20${filter ? `&filter=${filter}` : ''}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/creative-analysis/${id}`),
    onSuccess: () => {
      toast.success('Análise removida');
      qc.invalidateQueries({ queryKey: ['creative-history'] });
    },
    onError: () => toast.error('Erro ao remover'),
  });

  const filters = [
    { value: '', label: 'Todos' },
    { value: 'aprovado', label: '✅ Aprovados' },
    { value: 'aprovar_com_ressalvas', label: '⚠️ Ressalvas' },
    { value: 'reprovar', label: '❌ Reprovados' },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Palette className="h-6 w-6 text-[#1877F2]" />
            Histórico de Análises
          </h1>
          <p className="text-muted-foreground mt-1">
            {data?.total ?? 0} análises no total
          </p>
        </div>
        <Link
          to="/creative-analysis"
          className="flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565c0]"
        >
          + Nova análise
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => { setFilter(f.value); setPage(1); }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-[#1877F2] border-[#1877F2] text-white'
                : 'border-gray-300 text-gray-600 hover:border-[#1877F2] hover:text-[#1877F2]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Carregando...
            </div>
          ) : !data?.items.length ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Palette className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-muted-foreground">Nenhuma análise encontrada</p>
              <Link
                to="/creative-analysis"
                className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565c0]"
              >
                Fazer primeira análise
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {/* Header */}
              <div className="grid grid-cols-[1fr_80px_140px_80px_80px_80px] gap-3 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-gray-50">
                <span>Criativo</span>
                <span className="text-center">Score</span>
                <span>Recomendação</span>
                <span className="text-center">CTR real</span>
                <span className="text-center">CPL real</span>
                <span className="text-right">Ações</span>
              </div>
              {data.items.map((item) => (
                <div key={item.id}
                  className="grid grid-cols-[1fr_80px_140px_80px_80px_80px] gap-3 items-center px-4 py-3 hover:bg-gray-50"
                >
                  {/* Nome */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{item.fileName}</p>
                      {item.isComparison && (
                        <span className="flex-shrink-0 text-xs rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5">A/B</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{item.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>

                  {/* Score */}
                  <div className="flex justify-center">
                    <ScoreBadge score={item.overallScore} />
                  </div>

                  {/* Recomendação */}
                  <div>
                    <ApprovalBadge rec={item.approvalRecommendation} />
                  </div>

                  {/* CTR */}
                  <div className="text-center text-sm">
                    {item.realCtr != null ? (
                      <span className="font-medium text-green-700">{item.realCtr.toFixed(2)}%</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* CPL */}
                  <div className="text-center text-sm">
                    {item.realCpl != null ? (
                      <span className="font-medium">R$ {item.realCpl.toFixed(0)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/creative-analysis/${item.id}`}
                      className="rounded p-1.5 text-gray-400 hover:text-[#1877F2] hover:bg-blue-50"
                      title="Ver análise"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm('Remover esta análise?')) deleteMutation.mutate(item.id);
                      }}
                      className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Paginação */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded p-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">Página {page} de {data.totalPages}</span>
          <button
            disabled={page === data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded p-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
