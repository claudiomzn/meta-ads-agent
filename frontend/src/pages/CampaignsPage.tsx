import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Megaphone, TrendingUp, DollarSign, MoreVertical, Trash2, Pencil, Copy, Search, X } from 'lucide-react';
import { useCampaigns, useDeleteCampaign, useDuplicateCampaign } from '@/hooks/useCampaigns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatNumber } from '@/lib/utils';

const STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'outline' }> = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  PAUSED: { label: 'Pausado', variant: 'warning' },
  draft: { label: 'Rascunho', variant: 'secondary' },
  imported: { label: 'Importado', variant: 'outline' },
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'PAUSED', label: 'Pausado' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'imported', label: 'Importado' },
];

export default function CampaignsPage() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const duplicateCampaign = useDuplicateCampaign();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.product.toLowerCase().includes(search.toLowerCase());
    const statusKey = c.metaStatus ?? c.status;
    const matchesStatus = statusFilter === '' || statusKey === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg border bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-muted-foreground">
            {filtered.length !== campaigns.length
              ? `${filtered.length} de ${campaigns.length} campanha(s)`
              : `${campaigns.length} campanha(s) no total`}
          </p>
        </div>
        <Button asChild variant="meta">
          <Link to="/campaigns/new">
            <Plus className="h-4 w-4" />
            Nova campanha
          </Link>
        </Button>
      </div>

      {/* Busca + filtro de status */}
      {campaigns.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar por nome ou produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-2 font-medium transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-[#1877F2] text-white'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="rounded-full bg-gray-100 p-5">
              <Megaphone className="h-10 w-10 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="font-medium text-gray-700">Nenhuma campanha ainda</p>
              <p className="mt-1 text-sm text-muted-foreground">Crie sua primeira campanha com geração por IA</p>
            </div>
            <Button asChild variant="meta">
              <Link to="/campaigns/new">
                <Plus className="h-4 w-4" />
                Criar campanha
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma campanha encontrada para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const statusKey = c.metaStatus ?? c.status;
            const statusInfo = STATUS_LABELS[statusKey] ?? { label: statusKey, variant: 'secondary' as const };

            return (
              <div key={c.id} className="rounded-lg border bg-white p-5 hover:border-[#1877F2] transition-colors group">
                <div className="flex items-start justify-between gap-4">
                  <Link to={`/campaigns/${c.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-gray-900 group-hover:text-[#1877F2] transition-colors truncate">
                        {c.name}
                      </h3>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{c.product} · {c.objective}</p>

                    {/* Métricas reais */}
                    {c.metaSpend != null && (
                      <div className="mt-3 flex flex-wrap gap-4">
                        <div className="flex items-center gap-1.5 text-sm">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{formatCurrency(c.metaSpend)}</span>
                          <span className="text-muted-foreground">gasto</span>
                        </div>
                        {c.metaRoas != null && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{c.metaRoas.toFixed(2)}x</span>
                            <span className="text-muted-foreground">ROAS</span>
                          </div>
                        )}
                        {c.metaImpressions != null && (
                          <div className="text-sm text-muted-foreground">
                            {formatNumber(c.metaImpressions)} impressões
                          </div>
                        )}
                      </div>
                    )}
                  </Link>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {c.adSets.length} conjunto(s)
                    </span>
                    <Link
                      to={`/campaigns/${c.id}/edit`}
                      className="rounded p-1.5 text-gray-400 hover:text-[#1877F2] hover:bg-[#e7f0fd] transition-colors"
                      title="Editar campanha"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        duplicateCampaign.mutate(c.id);
                      }}
                      disabled={duplicateCampaign.isPending}
                      className="rounded p-1.5 text-gray-400 hover:text-[#1877F2] hover:bg-[#e7f0fd] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                      title="Duplicar campanha"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Deletar "${c.name}"?`)) deleteCampaign.mutate(c.id);
                      }}
                      className="rounded p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <Link
                      to={`/campaigns/${c.id}`}
                      className="rounded p-1 text-gray-400 hover:text-gray-600"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
