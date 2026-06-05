import { useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface CriterionScore {
  score: number;
  label: string;
  feedback: string;
  passed: boolean;
}

export interface CriteriaScores {
  visualHierarchy: CriterionScore;
  textArea: CriterionScore;
  humanElement: CriterionScore;
  contrast: CriterionScore;
  productFocus: CriterionScore;
  emotionalAppeal: CriterionScore;
  ctaVisibility: CriterionScore;
  copyCoherence: CriterionScore;
}

export interface FormatScore {
  score: number;
  recommendation: string;
}

export interface FormatScores {
  feed: FormatScore;
  stories: FormatScore;
  reels: FormatScore;
}

export interface Improvement {
  priority: 'alta' | 'media' | 'baixa';
  problem: string;
  solution: string;
  estimatedImpact: string;
}

export interface AnalysisResult {
  overallScore: number;
  summary: string;
  criteria: CriteriaScores;
  formatScores: FormatScores;
  strengths: string[];
  improvements: Improvement[];
  approvalRecommendation: 'aprovado' | 'aprovar_com_ressalvas' | 'reprovar';
  approvalReason: string;
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200">
      <div className={cn('h-1.5 rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ApprovalBadge({ rec }: { rec: string }) {
  const map = {
    aprovado: { label: 'Aprovado', className: 'bg-green-100 text-green-700 border-green-200' },
    aprovar_com_ressalvas: { label: 'Aprovar c/ ressalvas', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    reprovar: { label: 'Reprovar', className: 'bg-red-100 text-red-700 border-red-200' },
  };
  const m = map[rec as keyof typeof map] ?? map.reprovar;
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', m.className)}>{m.label}</span>;
}

function CriterionRow({ criterion }: { criterion: CriterionScore }) {
  const Icon = criterion.passed
    ? criterion.score >= 7 ? CheckCircle : AlertTriangle
    : XCircle;
  const iconColor = criterion.passed
    ? criterion.score >= 7 ? 'text-green-500' : 'text-yellow-500'
    : 'text-red-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', iconColor)} />
        <span className="text-xs font-medium text-gray-700 flex-1">{criterion.label}</span>
        <span className="text-xs font-bold text-gray-900">{criterion.score.toFixed(0)}/10</span>
      </div>
      <ScoreBar score={criterion.score} />
      <p className="text-xs text-muted-foreground pl-5">{criterion.feedback}</p>
    </div>
  );
}

const PRIORITY_MAP = {
  alta: { emoji: '🔴', label: 'Alta prioridade', color: 'border-red-200 bg-red-50' },
  media: { emoji: '🟡', label: 'Média prioridade', color: 'border-yellow-200 bg-yellow-50' },
  baixa: { emoji: '🟢', label: 'Baixa prioridade', color: 'border-green-200 bg-green-50' },
};

// ── CreativeScoreCard principal ───────────────────────────────────────────────

interface Props {
  analysis: AnalysisResult;
  fileName?: string;
  fileUrl?: string;
  onSave?: () => void;
  onUseCampaign?: () => void;
}

export function CreativeScoreCard({ analysis, fileName, fileUrl, onSave, onUseCampaign }: Props) {
  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const [improvOpen, setImprovOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const score = Number(analysis.overallScore ?? 0);
  const scoreColor = score >= 7 ? 'text-green-600' : score >= 4 ? 'text-yellow-600' : 'text-red-600';
  const scoreBg = score >= 7 ? 'border-green-200 bg-green-50' : score >= 4 ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50';

  function copySuggestions() {
    const text = analysis.improvements
      .map((imp, i) => `${i + 1}. [${imp.priority.toUpperCase()}] ${imp.problem}\n   Solução: ${imp.solution}\n   Impacto: ${imp.estimatedImpact}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Sugestões copiadas!');
    setTimeout(() => setCopied(false), 2000);
  }

  const criteria = Object.values(analysis.criteria ?? {}) as CriterionScore[];

  return (
    <div className="space-y-4">
      {/* 1. Score geral */}
      <Card className={cn('border-2', scoreBg)}>
        <CardContent className="pt-5">
          <div className="flex items-start gap-4">
            {fileUrl && (
              <img src={fileUrl} alt={fileName} className="h-20 w-20 rounded-lg object-cover flex-shrink-0 border" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={cn('text-5xl font-black', scoreColor)}>{score.toFixed(1)}</span>
                <div>
                  <p className="text-sm text-muted-foreground">/ 10</p>
                  <ApprovalBadge rec={analysis.approvalRecommendation} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{analysis.approvalReason}</p>
            </div>
          </div>
          <div className="mt-3">
            <ScoreBar score={score} />
          </div>
        </CardContent>
      </Card>

      {/* 2. Summary */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-gray-700 leading-relaxed">{analysis.summary}</p>
        </CardContent>
      </Card>

      {/* 3. Critérios */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setCriteriaOpen((o) => !o)}>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>8 Critérios de qualidade</span>
            {criteriaOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
        {criteriaOpen && (
          <CardContent className="space-y-3 pt-0">
            {criteria.map((c, i) => <CriterionRow key={i} criterion={c} />)}
          </CardContent>
        )}
      </Card>

      {/* 4. Score por formato */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Score por formato</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {(['feed', 'stories', 'reels'] as const).map((fmt) => {
            const f = analysis.formatScores?.[fmt];
            if (!f) return null;
            const s = Number(f.score ?? 0);
            const c = s >= 7 ? 'text-green-600 bg-green-50 border-green-200'
              : s >= 4 ? 'text-yellow-600 bg-yellow-50 border-yellow-200'
              : 'text-red-600 bg-red-50 border-red-200';
            return (
              <div key={fmt} className={cn('rounded-lg border p-3 text-center', c)}>
                <p className="text-lg font-black">{s.toFixed(0)}</p>
                <p className="text-xs font-semibold uppercase">{fmt === 'feed' ? 'Feed' : fmt === 'stories' ? 'Stories' : 'Reels'}</p>
                <p className="text-xs opacity-70 mt-1 leading-tight line-clamp-2">{f.recommendation}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 5. Pontos fortes */}
      {(analysis.strengths?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-700">✅ Pontos fortes</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1.5">
              {analysis.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-green-800">
                  <CheckCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-green-500" />
                  {s}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 6. Melhorias por prioridade */}
      {(analysis.improvements?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setImprovOpen((o) => !o)}>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Melhorias sugeridas ({analysis.improvements.length})</span>
              {improvOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          {improvOpen && (
            <CardContent className="space-y-3 pt-0">
              {[...analysis.improvements]
                .sort((a, b) => ({ alta: 0, media: 1, baixa: 2 }[a.priority] - { alta: 0, media: 1, baixa: 2 }[b.priority]))
                .map((imp, i) => {
                  const p = PRIORITY_MAP[imp.priority] ?? PRIORITY_MAP.media;
                  return (
                    <div key={i} className={cn('rounded-lg border p-3 space-y-1.5 text-sm', p.color)}>
                      <div className="flex items-center gap-1.5 font-semibold text-gray-800">
                        <span>{p.emoji}</span>
                        <span>{imp.problem}</span>
                      </div>
                      <p className="text-gray-700"><strong>Solução:</strong> {imp.solution}</p>
                      <p className="text-xs text-muted-foreground"><strong>Impacto estimado:</strong> {imp.estimatedImpact}</p>
                    </div>
                  );
                })}
            </CardContent>
          )}
        </Card>
      )}

      {/* 7. Botões de ação */}
      <div className="flex flex-wrap gap-2">
        {onSave && (
          <button
            onClick={onSave}
            className="flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565c0] transition-colors"
          >
            Salvar análise
          </button>
        )}
        <button
          onClick={copySuggestions}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {copied ? <><Check className="h-3.5 w-3.5 text-green-600" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar sugestões</>}
        </button>
        {onUseCampaign && (
          <button
            onClick={onUseCampaign}
            className="flex items-center gap-1.5 rounded-lg border border-[#1877F2] px-4 py-2 text-sm font-medium text-[#1877F2] hover:bg-[#e7f0fd] transition-colors"
          >
            Usar em campanha
          </button>
        )}
      </div>
    </div>
  );
}
