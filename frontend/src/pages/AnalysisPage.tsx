import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  Sparkles,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { useInsights, useRunAnalysis, type FullAnalysis, type CampaignSuggestion } from '@/hooks/useAnalysis';
import { useCreateCampaign } from '@/hooks/useCampaigns';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, prefix = '', suffix = '') {
  if (v === null || v === undefined) return '—';
  return `${prefix}${v.toFixed(2)}${suffix}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-5 w-5 text-[#1877F2]" />
      <h2 className="text-base font-semibold text-gray-900">{label}</h2>
    </div>
  );
}

function SuggestionCard({
  s,
  index,
  onUse,
  loading,
}: {
  s: CampaignSuggestion;
  index: number;
  onUse: (s: CampaignSuggestion) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              {index + 1}
            </span>
            <h3 className="font-semibold text-gray-900">{s.name}</h3>
          </div>
          <p className="text-sm text-gray-500 mb-2">{s.rationale}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{s.objective}</span>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">
              R$ {s.budget.toLocaleString('pt-BR')}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
              {s.adSets.length} conjunto{s.adSets.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => onUse(s)}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg bg-[#1877F2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166fe5] disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {loading ? 'Criando...' : 'Usar esta'}
          </button>
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Detalhes
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {s.adSets.map((as, i) => (
            <div key={i} className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700 mb-1">{as.name}</p>
              <p className="text-xs text-gray-500 mb-2">{as.rationale}</p>
              <div className="space-y-2">
                {as.ads.map((ad, j) => (
                  <div key={j} className="rounded border bg-white p-2">
                    <p className="text-xs font-medium text-gray-800">{ad.headline}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ad.bodyText}</p>
                    <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                      CTA: {ad.ctaType}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const navigate = useNavigate();
  const { data: insights, isLoading: insightsLoading } = useInsights();
  const runAnalysis = useRunAnalysis();
  const createCampaign = useCreateCampaign();

  const [result, setResult] = useState<FullAnalysis | null>(null);
  const [usingIdx, setUsingIdx] = useState<number | null>(null);

  async function handleRun() {
    try {
      const analysis = await runAnalysis.mutateAsync();
      setResult(analysis);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao executar análise');
    }
  }

  async function handleUseSuggestion(s: CampaignSuggestion, idx: number) {
    setUsingIdx(idx);
    try {
      const campaign = await createCampaign.mutateAsync({
        name: s.name,
        product: s.product,
        objective: s.objective,
        budget: s.budget,
        adSets: s.adSets.map(as => ({
          name: as.name,
          dailyBudget: as.dailyBudget,
          targeting: as.targeting,
          optimizationGoal: as.optimizationGoal,
          billingEvent: as.billingEvent,
          ads: as.ads.map(ad => ({
            name: ad.name,
            headline: ad.headline,
            bodyText: ad.bodyText,
            cta: ad.ctaType,
          })),
        })),
      });
      navigate(`/campaigns/${campaign.id}`);
    } catch {
      alert('Erro ao criar campanha');
    } finally {
      setUsingIdx(null);
    }
  }

  const analysis = result;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="h-6 w-6 text-[#1877F2]" />
            Análise IA
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            O agente analisa todo o histórico de campanhas e sugere novas estratégias baseadas no que funcionou.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={runAnalysis.isPending}
          className="flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#166fe5] disabled:opacity-50"
        >
          {runAnalysis.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Analisando...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Analisar campanhas
            </>
          )}
        </button>
      </div>

      {/* Estado inicial — sem análise rodada ainda */}
      {!analysis && !runAnalysis.isPending && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white p-10 text-center">
          <Brain className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500 font-medium mb-1">Nenhuma análise realizada ainda</p>
          <p className="text-sm text-gray-400 mb-6">
            Clique em "Analisar campanhas" para o agente IA revisar seu histórico e sugerir novas estratégias.
          </p>

          {/* Análises anteriores */}
          {insightsLoading ? null : insights && insights.length > 0 ? (
            <div className="text-left mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                Análises anteriores
              </p>
              <div className="space-y-2">
                {insights.map(i => (
                  <div key={i.id} className="flex items-center gap-3 rounded-lg border p-3 bg-gray-50">
                    <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{i.title}</p>
                      <p className="text-xs text-gray-400">{fmtDate(i.createdAt)}</p>
                    </div>
                    <span className="text-xs text-gray-400">{i.campaignsCount} camps.</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Loading */}
      {runAnalysis.isPending && (
        <div className="rounded-xl border bg-white p-10 text-center">
          <RefreshCw className="mx-auto h-10 w-10 text-[#1877F2] animate-spin mb-4" />
          <p className="font-medium text-gray-700">Analisando campanhas com IA...</p>
          <p className="text-sm text-gray-400 mt-1">Isso pode levar alguns segundos</p>
        </div>
      )}

      {/* Resultado */}
      {analysis && (
        <div className="space-y-6">
          {/* Resumo executivo */}
          <div className="rounded-xl border bg-gradient-to-br from-blue-50 to-white p-6">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-5 w-5 text-[#1877F2]" />
              <h2 className="font-semibold text-gray-900">Resumo Executivo</h2>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{analysis.summary}</p>

            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-white border p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Gasto total</p>
                <p className="text-lg font-bold text-gray-900">
                  {analysis.totalSpend > 0 ? `R$ ${analysis.totalSpend.toFixed(2)}` : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-white border p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">ROAS médio</p>
                <p className="text-lg font-bold text-gray-900">
                  {fmt(analysis.avgRoas, '', 'x')}
                </p>
              </div>
              <div className="rounded-lg bg-white border p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Sugestões geradas</p>
                <p className="text-lg font-bold text-[#1877F2]">{analysis.suggestions.length}</p>
              </div>
            </div>
          </div>

          {/* Vencedores */}
          {analysis.winners.length > 0 && (
            <div className="rounded-xl border bg-white p-5">
              <SectionTitle icon={TrendingUp} label="Melhores Campanhas" />
              <div className="space-y-3">
                {analysis.winners.map(w => (
                  <div key={w.campaignId} className="rounded-lg bg-green-50 border border-green-100 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900">{w.name}</p>
                      <div className="flex gap-3 text-xs">
                        {w.roas !== null && (
                          <span className="font-semibold text-green-700">ROAS {w.roas.toFixed(2)}x</span>
                        )}
                        {w.cpl !== null && (
                          <span className="text-gray-500">CPL R$ {w.cpl.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {w.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                          <TrendingUp className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lições */}
          {analysis.losers.length > 0 && (
            <div className="rounded-xl border bg-white p-5">
              <SectionTitle icon={TrendingDown} label="Lições Aprendidas" />
              <div className="space-y-3">
                {analysis.losers.map(l => (
                  <div key={l.campaignId} className="rounded-lg bg-red-50 border border-red-100 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900">{l.name}</p>
                      {l.roas !== null && (
                        <span className="text-xs font-semibold text-red-600">ROAS {l.roas.toFixed(2)}x</span>
                      )}
                    </div>
                    <ul className="space-y-1">
                      {l.lessons.map((lesson, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                          <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                          {lesson}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Padrões detectados */}
          {analysis.patterns.length > 0 && (
            <div className="rounded-xl border bg-white p-5">
              <SectionTitle icon={Lightbulb} label="Padrões Detectados" />
              <div className="grid gap-3 sm:grid-cols-2">
                {analysis.patterns.map((p, i) => (
                  <div key={i} className="rounded-lg bg-yellow-50 border border-yellow-100 p-4">
                    <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-1">
                      {p.category}
                    </p>
                    <p className="text-sm text-gray-700 mb-2">{p.insight}</p>
                    <div className="flex items-start gap-1.5">
                      <ChevronRight className="h-3.5 w-3.5 text-yellow-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-yellow-800 font-medium">{p.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sugestões de novas campanhas */}
          {analysis.suggestions.length > 0 && (
            <div className="rounded-xl border bg-white p-5">
              <SectionTitle icon={Sparkles} label="Campanhas Sugeridas pela IA" />
              <p className="text-xs text-gray-500 mb-4">
                Baseadas nos padrões do seu histórico. Clique em "Usar esta" para criar imediatamente.
              </p>
              <div className="space-y-4">
                {analysis.suggestions.map((s, i) => (
                  <SuggestionCard
                    key={i}
                    s={s}
                    index={i}
                    onUse={sug => handleUseSuggestion(sug, i)}
                    loading={usingIdx === i && createCampaign.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Botão para nova análise */}
          <div className="flex justify-center pb-4">
            <button
              onClick={handleRun}
              disabled={runAnalysis.isPending}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refazer análise
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
