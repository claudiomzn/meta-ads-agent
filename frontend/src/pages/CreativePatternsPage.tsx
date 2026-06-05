import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Palette, TrendingUp, BarChart2, Loader2 } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '@/services/api';
import { useMCPStatus } from '@/hooks/useMCP';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface PatternResult {
  hasEnoughData: boolean;
  totalAnalyzed?: number;
  patterns?: string[];
  scoreVsPerformance?: string;
  winnerCharacteristics?: string[];
  loserCharacteristics?: string[];
  dataPoints?: Array<{ score: number; ctr: number; fileName: string }>;
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fileName: string; score: number; ctr: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-white p-2 shadow text-xs">
      <p className="font-medium truncate max-w-[150px]">{d.fileName}</p>
      <p>Score: <strong>{d.score.toFixed(1)}</strong></p>
      <p>CTR: <strong>{d.ctr.toFixed(2)}%</strong></p>
    </div>
  );
}

export default function CreativePatternsPage() {
  const { data: mcpStatus } = useMCPStatus();
  const adAccountId = mcpStatus?.adAccountIds?.[0] ?? 'none';

  const { data, isLoading } = useQuery<PatternResult>({
    queryKey: ['creative-patterns', adAccountId],
    queryFn: () => api.get(`/creative-analysis/patterns/${adAccountId}`),
    enabled: !!mcpStatus,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-[#1877F2]" />
            Padrões de Performance
          </h1>
          <p className="text-muted-foreground mt-1">
            Correlação entre score IA e CTR real dos seus criativos
          </p>
        </div>
        <Link
          to="/creative-analysis"
          className="flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565c0]"
        >
          <Palette className="h-4 w-4" /> Nova análise
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando padrões...
        </div>
      )}

      {!isLoading && data && !data.hasEnoughData && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6 text-center space-y-4 pb-8">
            <div className="text-5xl">📊</div>
            <div>
              <p className="font-semibold text-blue-900 text-lg">Dados insuficientes</p>
              <p className="text-sm text-blue-700 mt-1">
                Para identificar padrões, você precisa de <strong>5 ou mais análises</strong> com métricas reais (CTR).<br />
                As métricas são sincronizadas automaticamente após publicar e vincular um anúncio à análise.
              </p>
            </div>
            <div className="flex flex-col items-center gap-2 text-sm text-blue-800">
              <p>Como começar:</p>
              <ol className="text-left space-y-1">
                <li>1. Analise seus criativos em <Link to="/creative-analysis" className="underline">Nova Análise</Link></li>
                <li>2. Publique a campanha vinculando o criativo ao anúncio</li>
                <li>3. Após o Meta sincronizar as métricas, os dados aparecem aqui</li>
              </ol>
            </div>
            <Link
              to="/creative-analysis"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565c0]"
            >
              Analisar primeiro criativo
            </Link>
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.hasEnoughData && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-black text-[#1877F2]">{data.totalAnalyzed}</p>
                <p className="text-sm text-muted-foreground">Criativos analisados</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-black text-green-600">
                  {data.dataPoints ? (
                    (data.dataPoints.filter(d => d.score >= 7).length / data.dataPoints.length * 100).toFixed(0)
                  ) : '—'}%
                </p>
                <p className="text-sm text-muted-foreground">Score ≥ 7.0 (aprovados)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-black text-purple-600">
                  {data.dataPoints ? (
                    (data.dataPoints.reduce((s, d) => s + d.ctr, 0) / data.dataPoints.length).toFixed(2)
                  ) : '—'}%
                </p>
                <p className="text-sm text-muted-foreground">CTR médio geral</p>
              </CardContent>
            </Card>
          </div>

          {/* Scatter chart */}
          {data.dataPoints && data.dataPoints.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#1877F2]" />
                  Score IA vs CTR Real
                </CardTitle>
                <CardDescription>Cada ponto representa um criativo analisado</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="score" name="Score IA" type="number" domain={[0, 10]}
                      label={{ value: 'Score IA', position: 'insideBottom', offset: -10, fontSize: 11 }}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      dataKey="ctr" name="CTR" unit="%"
                      label={{ value: 'CTR %', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip content={<ScatterTooltip />} />
                    <ReferenceLine x={7} stroke="#1877F2" strokeDasharray="4 4" label={{ value: 'Score 7', fontSize: 10, fill: '#1877F2' }} />
                    <Scatter
                      data={data.dataPoints}
                      fill="#1877F2"
                      opacity={0.7}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Score vs performance insight */}
          {data.scoreVsPerformance && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <p className="text-sm font-semibold text-blue-800 mb-1">📈 Correlação Score vs Performance</p>
                <p className="text-sm text-blue-700">{data.scoreVsPerformance}</p>
              </CardContent>
            </Card>
          )}

          {/* Padrões */}
          {data.patterns && data.patterns.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">💡 Padrões identificados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.patterns.map((p, i) => (
                  <div key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-[#1877F2] font-bold flex-shrink-0">{i + 1}.</span>
                    {p}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Vencedores e perdedores */}
          <div className="grid gap-4 sm:grid-cols-2">
            {data.winnerCharacteristics && (
              <Card className="border-green-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-green-700">✅ Criativos vencedores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {data.winnerCharacteristics.map((c, i) => (
                    <p key={i} className="text-sm text-green-800 flex gap-2">
                      <span className="flex-shrink-0">•</span>{c}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
            {data.loserCharacteristics && (
              <Card className="border-red-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-700">❌ Criativos perdedores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {data.loserCharacteristics.map((c, i) => (
                    <p key={i} className="text-sm text-red-800 flex gap-2">
                      <span className="flex-shrink-0">•</span>{c}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
