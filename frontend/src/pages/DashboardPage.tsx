import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, DollarSign, MousePointerClick, Users, Zap, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/services/api';
import { useMCPStatus } from '@/hooks/useMCP';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface Campaign {
  id: string;
  name: string;
  status: string;
  metaStatus?: string;
  metaSpend?: number;
  metaRoas?: number;
  metaCpc?: number;
  metaCpl?: number;
  metaImpressions?: number;
  metaClicks?: number;
  updatedAt: string;
}

function MetricCard({
  title,
  value,
  sub,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="rounded-lg bg-[#e7f0fd] p-2">
              <Icon className="h-5 w-5 text-[#1877F2]" />
            </div>
            {trend && (
              trend === 'up' ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : trend === 'down' ? (
                <TrendingDown className="h-4 w-4 text-red-500" />
              ) : null
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertItem({ text, type }: { text: string; type: 'warning' | 'success' | 'info' }) {
  const icons = {
    warning: <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />,
    success: <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />,
    info: <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />,
  };
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      {icons[type]}
      <span>{text}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { data: mcpStatus } = useMCPStatus();
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns'),
  });

  const published = campaigns.filter((c) => c.metaSpend != null);

  const totals = published.reduce(
    (acc, c) => ({
      spend: acc.spend + (c.metaSpend ?? 0),
      impressions: acc.impressions + (c.metaImpressions ?? 0),
      clicks: acc.clicks + (c.metaClicks ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0 },
  );

  const avgRoas = published.length
    ? published.reduce((s, c) => s + (c.metaRoas ?? 0), 0) / published.length
    : 0;

  const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

  // Mock de dados para o gráfico de área (em produção viria do backend)
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      gasto: Math.random() * 500 + 100,
      leads: Math.floor(Math.random() * 30 + 5),
    };
  });

  // Alertas inteligentes baseados nas métricas reais
  const alerts: { text: string; type: 'warning' | 'success' | 'info' }[] = [];
  for (const c of published) {
    if ((c.metaRoas ?? 0) > 5) {
      alerts.push({ text: `"${c.name}" está com ROAS ${c.metaRoas?.toFixed(1)} — considere escalar o orçamento`, type: 'success' });
    }
    if ((c.metaCpc ?? 0) > 5) {
      alerts.push({ text: `"${c.name}" com CPC alto (${formatCurrency(c.metaCpc ?? 0)}) — revise a segmentação`, type: 'warning' });
    }
  }
  if (alerts.length === 0 && published.length > 0) {
    alerts.push({ text: 'Todas as campanhas estão dentro dos parâmetros normais', type: 'info' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral das suas campanhas</p>
        </div>
        <Button asChild variant="meta">
          <Link to="/campaigns/new">+ Nova campanha</Link>
        </Button>
      </div>

      {/* Métricas reais ou estado vazio */}
      {!mcpStatus?.connected ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="rounded-full bg-gray-100 p-4">
              <Zap className="h-8 w-8 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="font-medium">Meta Ads não conectado</p>
              <p className="mt-1 text-sm text-muted-foreground">Conecte sua conta para ver métricas reais ao vivo</p>
            </div>
            <Button asChild variant="meta">
              <Link to="/onboarding">Conectar agora</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cards de métricas */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Gasto total (30 dias)" value={formatCurrency(totals.spend)} icon={DollarSign} trend="neutral" />
            <MetricCard title="ROAS médio" value={avgRoas.toFixed(2) + 'x'} icon={TrendingUp} trend={avgRoas >= 3 ? 'up' : 'down'} />
            <MetricCard title="Total de cliques" value={formatNumber(totals.clicks)} sub={`CTR ${formatPercent(avgCtr)}`} icon={MousePointerClick} />
            <MetricCard title="Campanhas ativas" value={String(published.length)} sub={`${campaigns.length} total`} icon={Users} />
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance — últimos 14 dias</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorGasto" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1877F2" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#1877F2" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Area type="monotone" dataKey="gasto" stroke="#1877F2" fill="url(#colorGasto)" strokeWidth={2} name="Gasto (R$)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Alertas IA + campanhas recentes */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alertas inteligentes</CardTitle>
                <CardDescription>Gerados com base nas métricas reais</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.map((a, i) => <AlertItem key={i} {...a} />)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campanhas recentes</CardTitle>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
                ) : (
                  <div className="space-y-3">
                    {campaigns.slice(0, 5).map((c) => (
                      <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center justify-between rounded-md border p-3 hover:bg-gray-50 transition-colors">
                        <div>
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.metaSpend != null ? formatCurrency(c.metaSpend) + ' gasto' : 'Rascunho'}</p>
                        </div>
                        <Badge variant={c.metaStatus === 'ACTIVE' ? 'success' : c.metaStatus === 'PAUSED' ? 'warning' : 'secondary'}>
                          {c.metaStatus ?? c.status}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
