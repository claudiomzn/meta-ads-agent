import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, DollarSign, MousePointerClick, Users, Zap, AlertTriangle, CheckCircle, Info, BarChart2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/services/api';
import { useMCPStatus } from '@/hooks/useMCP';
import { useChartData, useDashboardSummary } from '@/hooks/useDashboard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { DailyActionsPanel } from '@/components/DailyActionsPanel';
import { HealthScoreCard } from '@/components/HealthScoreCard';
import { MetricTooltip } from '@/components/MetricTooltip';
import { OnboardingWizard } from '@/components/OnboardingWizard';

interface Campaign {
  id: string;
  name: string;
  status: string;
  metaStatus?: string;
  metaSpend?: number;
  metaRoas?: number;
  metaCpc?: number;
  metaImpressions?: number;
  metaClicks?: number;
}

function MetricCard({
  title,
  value,
  sub,
  icon: Icon,
  trend,
  tooltipKey,
  delta,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  tooltipKey?: React.ComponentProps<typeof MetricTooltip>['metric'];
  /** delta semana a semana. Ex: 12.5 = +12.5 %, -8 = -8 % */
  delta?: number;
}) {
  const deltaColor = delta == null ? '' : delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  const deltaIcon  = delta == null ? null : delta > 0
    ? <TrendingUp className="h-3 w-3" />
    : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {tooltipKey ? (
                <MetricTooltip metric={tooltipKey}>{title}</MetricTooltip>
              ) : title}
            </p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
            {delta != null && (
              <p className={cn('mt-1 flex items-center gap-0.5 text-xs font-medium', deltaColor)}>
                {deltaIcon}
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}% vs semana passada
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="rounded-lg bg-[#e7f0fd] p-2">
              <Icon className="h-5 w-5 text-[#1877F2]" />
            </div>
            {trend === 'up' && <TrendingUp className="h-4 w-4 text-green-500" />}
            {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-500" />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Narrativa humana para modo leigo — conta a história dos números */
function NarrativeCard({
  spend, impressions, clicks, avgRoas, activeCampaigns, onSeeDetails,
}: {
  spend: number; impressions: number; clicks: number;
  avgRoas: number; activeCampaigns: number;
  onSeeDetails: () => void;
}) {
  // Semáforo baseado no ROAS
  const semaforo = avgRoas >= 3 ? { emoji: '🟢', label: 'Tudo certo', color: 'text-green-600' }
    : avgRoas >= 1.5           ? { emoji: '🟡', label: 'Pode melhorar', color: 'text-yellow-600' }
    : avgRoas > 0              ? { emoji: '🔴', label: 'Precisa de atenção', color: 'text-red-600' }
    :                            { emoji: '⚪', label: 'Aguardando dados', color: 'text-gray-400' };

  // Custo por clique
  const cpc = clicks > 0 && spend > 0 ? spend / clicks : null;

  // Monta a narrativa
  const parts: string[] = [];
  if (spend > 0)        parts.push(`você investiu **${formatCurrency(spend)}** em anúncios`);
  if (impressions > 0)  parts.push(`seus anúncios foram vistos **${formatNumber(impressions)} vezes**`);
  if (clicks > 0)       parts.push(`${formatNumber(clicks)} pessoas clicaram`);
  if (cpc != null)      parts.push(`cada clique custou **${formatCurrency(cpc)}**`);
  if (avgRoas > 0) {
    const ganho = (spend * avgRoas).toFixed(0);
    parts.push(`para cada R$ 1,00 investido você teve **R$ ${avgRoas.toFixed(2)} de retorno** (total aproximado: R$ ${ganho})`);
  }

  const hasSomeData = spend > 0 || impressions > 0;

  return (
    <div className="rounded-2xl border bg-white p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Resumo do mês</span>
        <button onClick={onSeeDetails} className="text-xs text-[#1877F2] hover:underline">
          ver métricas detalhadas →
        </button>
      </div>

      {/* Semáforo + narrativa */}
      {hasSomeData ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{semaforo.emoji}</span>
            <span className={cn('text-sm font-bold', semaforo.color)}>{semaforo.label}</span>
            {activeCampaigns > 0 && (
              <span className="text-xs text-gray-400">· {activeCampaigns} campanha{activeCampaigns > 1 ? 's' : ''} ativa{activeCampaigns > 1 ? 's' : ''}</span>
            )}
          </div>

          <p className="text-base text-gray-700 leading-relaxed">
            {parts.length === 0
              ? 'Sincronize sua conta do Meta para ver o resumo aqui.'
              : parts.map((part, i) => {
                  const formatted = part.split(/\*\*(.+?)\*\*/).map((seg, j) =>
                    j % 2 === 1
                      ? <strong key={j} className="text-gray-900">{seg}</strong>
                      : <span key={j}>{seg}</span>
                  );
                  return (
                    <span key={i}>
                      {i === 0
                        ? <><span className="capitalize">Nos últimos 30 dias, </span>{formatted}</>
                        : <>{i === parts.length - 1 ? '. E ' : ', '}{formatted}</>
                      }
                    </span>
                  );
                })
            }
            {parts.length > 0 && '.'}
          </p>
        </>
      ) : (
        <div className="text-center py-4">
          <p className="text-2xl mb-2">⚪</p>
          <p className="text-sm text-gray-500">Nenhum dado ainda.</p>
          <p className="text-xs text-gray-400 mt-1">Publique uma campanha ou sincronize sua conta do Meta para ver o resumo aqui.</p>
        </div>
      )}
    </div>
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

type ChartMetric = 'spend' | 'clicks' | 'impressions';

export default function DashboardPage() {
  const { data: mcpStatus } = useMCPStatus();
  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns'),
  });

  // Modo leigo vs avançado — definido no onboarding, editável pelo toggle
  const [isBeginnerMode, setBeginnerMode] = useState(() => {
    return localStorage.getItem('metaAdsMode') !== 'advanced';
  });
  function toggleMode() {
    const next = !isBeginnerMode;
    setBeginnerMode(next);
    localStorage.setItem('metaAdsMode', next ? 'beginner' : 'advanced');
  }

  // Onboarding wizard: mostra na primeira visita enquanto não há campanhas
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('metaAgentOnboarded');
  });
  function dismissOnboarding() {
    localStorage.setItem('metaAgentOnboarded', '1');
    setShowOnboarding(false);
  }
  const shouldShowWizard = showOnboarding && !campaignsLoading && campaigns.length === 0;

  // Dados reais do banco
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<ChartMetric>('spend');
  const { data: chartData = [], isLoading: chartLoading } = useChartData(days);
  const { data: summary } = useDashboardSummary();

  // Totais consolidados — usa summary da API quando disponível, senão calcula localmente
  const spend = summary?.spend ?? campaigns.reduce((s, c) => s + (c.metaSpend ?? 0), 0);
  const clicks = summary?.clicks ?? campaigns.reduce((s, c) => s + (c.metaClicks ?? 0), 0);
  const impressions = summary?.impressions ?? campaigns.reduce((s, c) => s + (c.metaImpressions ?? 0), 0);
  const avgRoas = summary?.avgRoas ?? 0;
  const ctr = summary?.ctr ?? (impressions > 0 ? (clicks / impressions) * 100 : 0);
  const activeCampaigns = summary?.activeCampaigns ?? campaigns.filter(c => c.metaStatus === 'ACTIVE').length;

  // Deltas semana a semana (usa chartData dos últimos 14 dias)
  const { data: chartData14 = [] } = useChartData(14);
  function calcDelta(field: 'spend' | 'clicks' | 'impressions'): number | undefined {
    if (chartData14.length < 14) return undefined;
    const half = Math.floor(chartData14.length / 2);
    const prev = chartData14.slice(0, half).reduce((s, d) => s + (d[field] as number), 0);
    const curr = chartData14.slice(half).reduce((s, d) => s + (d[field] as number), 0);
    if (prev === 0) return undefined;
    return ((curr - prev) / prev) * 100;
  }
  const spendDelta   = calcDelta('spend');
  const clicksDelta  = calcDelta('clicks');

  // Alertas inteligentes — linguagem adaptada ao modo (leigo vs avançado)
  const published = campaigns.filter((c) => c.metaSpend != null);
  const alerts: { text: string; type: 'warning' | 'success' | 'info' }[] = [];
  for (const c of published) {
    if ((c.metaRoas ?? 0) > 5) {
      alerts.push({
        text: isBeginnerMode
          ? `"${c.name}" está dando muito retorno! Para cada R$ 1,00 gasto você recebeu R$ ${c.metaRoas?.toFixed(1)} — vale aumentar o investimento`
          : `"${c.name}" com ROAS ${c.metaRoas?.toFixed(1)}x — considere escalar o orçamento`,
        type: 'success',
      });
    }
    if ((c.metaCpc ?? 0) > 5) {
      alerts.push({
        text: isBeginnerMode
          ? `"${c.name}" está custando caro por clique (${formatCurrency(c.metaCpc ?? 0)} por pessoa). Veja se o público está bem definido`
          : `"${c.name}" com CPC alto (${formatCurrency(c.metaCpc ?? 0)}) — revise a segmentação`,
        type: 'warning',
      });
    }
  }
  if (alerts.length === 0 && published.length > 0) {
    alerts.push({
      text: isBeginnerMode
        ? 'Tudo certo! Suas campanhas estão funcionando normalmente'
        : 'Todas as campanhas estão dentro dos parâmetros normais',
      type: 'info',
    });
  }

  const metricConfig: Record<ChartMetric, { label: string; color: string; format: (v: number) => string }> = {
    spend:       { label: 'Gasto (R$)',    color: '#1877F2', format: formatCurrency },
    clicks:      { label: 'Cliques',       color: '#10b981', format: formatNumber },
    impressions: { label: 'Impressões',    color: '#f59e0b', format: formatNumber },
  };

  const hasChartData = chartData.some(d => d[metric] > 0);

  const lastSyncAt = summary?.lastSyncAt;

  return (
    <div className="space-y-6">
      {shouldShowWizard && <OnboardingWizard onDismiss={dismissOnboarding} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-muted-foreground text-sm">Visão geral das suas campanhas</p>
            {lastSyncAt && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                Sync {new Date(lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle modo leigo / avançado */}
          <button
            onClick={toggleMode}
            title={isBeginnerMode ? 'Mudar para modo avançado' : 'Mudar para modo simplificado'}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            {isBeginnerMode ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {isBeginnerMode ? 'Modo simplificado' : 'Modo avançado'}
          </button>
          <Button asChild variant="meta">
            <Link to="/campaigns/new">+ Nova campanha</Link>
          </Button>
        </div>
      </div>

      {/* IA Panels — sempre visíveis */}
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthScoreCard />
        <DailyActionsPanel />
      </div>

      {!mcpStatus?.connected ? (
        <div className="space-y-4">
          {/* Banner de conexão — compacto, não bloqueia o resto */}
          <div className="rounded-xl border border-dashed border-[#1877F2]/40 bg-[#1877F2]/5 p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-[#1877F2]/10 p-2">
                <Zap className="h-5 w-5 text-[#1877F2]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Conecte sua conta do Meta Ads</p>
                <p className="text-xs text-muted-foreground">Métricas reais, alertas automáticos e otimizações com IA</p>
              </div>
            </div>
            <Button asChild variant="meta" size="sm">
              <Link to="/onboarding">Conectar agora</Link>
            </Button>
          </div>

          {/* Primeiros passos — útil mesmo sem Meta conectado */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Por onde começar</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: '📂', title: 'Use um template', desc: 'Campanhas prontas por nicho — clínica, loja, academia e mais. Edite e publique em minutos.', to: '/templates', cta: 'Ver templates' },
                { icon: '✍️', title: 'Crie copies com IA', desc: 'Gere textos persuasivos para headlines, legendas e CTAs baseados no seu produto.', to: '/copies', cta: 'Criar copies' },
                { icon: '🎯', title: 'Salve um público', desc: 'Defina o perfil ideal do seu cliente para reutilizar em todas as campanhas.', to: '/audiences', cta: 'Novo público' },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-xl border bg-white p-4 hover:shadow-md hover:border-[#1877F2]/30 transition-all group"
                >
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <p className="text-sm font-semibold text-gray-800 group-hover:text-[#1877F2] transition-colors">{item.title}</p>
                  <p className="text-xs text-gray-400 mt-1 mb-3 leading-relaxed">{item.desc}</p>
                  <span className="text-xs font-semibold text-[#1877F2]">{item.cta} →</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Cards de métricas — narrativa (leigo) ou técnico (avançado) */}
          {isBeginnerMode ? (
            <NarrativeCard
              spend={spend}
              impressions={impressions}
              clicks={clicks}
              avgRoas={avgRoas}
              activeCampaigns={activeCampaigns}
              onSeeDetails={toggleMode}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Gasto total (30d)" value={formatCurrency(spend)} icon={DollarSign} trend="neutral" tooltipKey="orcamento" delta={spendDelta} />
              <MetricCard title="ROAS médio" value={avgRoas > 0 ? avgRoas.toFixed(2) + 'x' : '—'} icon={TrendingUp} trend={avgRoas >= 3 ? 'up' : avgRoas > 0 ? 'down' : 'neutral'} tooltipKey="roas" />
              <MetricCard title="Cliques totais" value={formatNumber(clicks)} sub={ctr > 0 ? `CTR ${formatPercent(ctr)}` : undefined} icon={MousePointerClick} tooltipKey="cliques" delta={clicksDelta} />
              <MetricCard title="Campanhas ativas" value={String(activeCampaigns)} sub={`${campaigns.length} total`} icon={Users} />
            </div>
          )}

          {/* Gráfico com dados reais */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-[#1877F2]" />
                    Performance por dia
                    {!hasChartData && !chartLoading && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        (dados aparecem após o primeiro sync)
                      </span>
                    )}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {/* Seletor de métrica */}
                  <div className="flex rounded-lg border overflow-hidden text-xs">
                    {(Object.keys(metricConfig) as ChartMetric[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMetric(m)}
                        className={cn(
                          'px-3 py-1.5 font-medium transition-colors',
                          metric === m ? 'bg-[#1877F2] text-white' : 'text-gray-500 hover:bg-gray-50',
                        )}
                      >
                        {metricConfig[m].label}
                      </button>
                    ))}
                  </div>
                  {/* Seletor de período */}
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="rounded-lg border px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#1877F2]"
                  >
                    <option value={7}>7 dias</option>
                    <option value={14}>14 dias</option>
                    <option value={30}>30 dias</option>
                    <option value={60}>60 dias</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {chartLoading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1877F2] border-t-transparent" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={metricConfig[metric].color} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={metricConfig[metric].color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number) => [metricConfig[metric].format(v), metricConfig[metric].label]}
                      labelFormatter={(label) => `Dia: ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey={metric}
                      stroke={metricConfig[metric].color}
                      fill="url(#colorMetric)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Alertas IA + campanhas recentes */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alertas inteligentes</CardTitle>
                <CardDescription>Baseados nas métricas reais das campanhas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha com métricas ainda.</p>
                ) : (
                  alerts.map((a, i) => <AlertItem key={i} {...a} />)
                )}
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
                      <Link
                        key={c.id}
                        to={`/campaigns/${c.id}`}
                        className="flex items-center justify-between rounded-md border p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.metaSpend != null ? formatCurrency(c.metaSpend) + ' gasto' : 'Rascunho'}
                          </p>
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
