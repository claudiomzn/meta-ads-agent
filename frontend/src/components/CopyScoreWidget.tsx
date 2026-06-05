import { useState } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, Loader2, ChevronDown, ChevronUp, Wand2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

export interface CopyScore {
  score: number;
  strengths: string[];
  issues: string[];
  suggestion: string;
}

export interface ImprovedCopy {
  headline: string;
  body: string;
  cta: string;
}

interface Props {
  headline: string;
  body: string;
  cta: string;
  objective?: string;
  product?: string;
  /** Exibe o botão inline (padrão) ou em modo compacto sem label */
  compact?: boolean;
  /** Chamado quando o usuário clica em "Usar copy melhorada" */
  onApplyImproved?: (improved: ImprovedCopy) => void;
}

function ScoreBadge({ score }: { score: number | undefined }) {
  const s = Number(score ?? 0);
  const color =
    s >= 7.5 ? 'bg-green-100 text-green-700 border-green-200'
    : s >= 5  ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
    : 'bg-red-100 text-red-700 border-red-200';

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-bold', color)}>
      {s.toFixed(1)}<span className="font-normal text-xs opacity-70">/10</span>
    </span>
  );
}

function CopyClipboard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy}
      className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <><Check className="h-3 w-3 text-green-600" />Copiado</> : <><Copy className="h-3 w-3" />Copiar</>}
    </button>
  );
}

export function CopyScoreWidget({ headline, body, cta, objective, product, compact, onApplyImproved }: Props) {
  const [loading, setLoading] = useState(false);
  const [improving, setImproving] = useState(false);
  const [result, setResult] = useState<CopyScore | null>(null);
  const [improved, setImproved] = useState<ImprovedCopy | null>(null);
  const [open, setOpen] = useState(false);
  const [showImproved, setShowImproved] = useState(false);

  async function analyze() {
    if (!headline || !body || !cta) {
      toast.error('Preencha headline, body e CTA antes de analisar.');
      return;
    }
    setLoading(true);
    setImproved(null);
    setShowImproved(false);
    try {
      const data = await api.post<CopyScore>('/copies/score', { headline, body, cta, objective, product });
      setResult(data);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao analisar copy');
    } finally {
      setLoading(false);
    }
  }

  async function improve() {
    if (!result) return;
    setImproving(true);
    try {
      const data = await api.post<ImprovedCopy>('/copies/improve', {
        headline, body, cta, objective, product,
        issues: result.issues,
        suggestion: result.suggestion,
      });
      setImproved(data);
      setShowImproved(true);
      toast.success('Copy melhorada gerada!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao melhorar copy');
    } finally {
      setImproving(false);
    }
  }

  const score = Number(result?.score ?? 0);

  return (
    <div className="w-full space-y-2">
      {/* Linha de botões principais */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={analyze}
          disabled={loading || improving}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
            'border-[#1877F2] text-[#1877F2] hover:bg-[#e7f0fd] disabled:opacity-50',
          )}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando...</>
            : <><Sparkles className="h-3.5 w-3.5" /> {compact ? 'Score IA' : 'Analisar copy com IA'}</>}
        </button>

        {result && !loading && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ScoreBadge score={result.score} />
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Painel de análise */}
      {result && open && (
        <div className={cn(
          'rounded-lg border p-3 text-xs space-y-2.5',
          score >= 7.5 ? 'border-green-200 bg-green-50'
          : score >= 5  ? 'border-yellow-200 bg-yellow-50'
          : 'border-red-200 bg-red-50',
        )}>
          {/* Nota geral */}
          <div className="flex items-center gap-2">
            <ScoreBadge score={result.score} />
            <span className="font-medium text-gray-700">
              {score >= 7.5 ? 'Excelente copy!'
                : score >= 5 ? 'Copy com potencial'
                : 'Copy precisa de ajustes'}
            </span>
          </div>

          {/* Pontos fortes */}
          {(result.strengths?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-green-700 flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3" /> Pontos fortes
              </p>
              <ul className="space-y-0.5 text-green-800">
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex gap-1.5"><span>✓</span>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Problemas */}
          {(result.issues?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-red-700 flex items-center gap-1 mb-1">
                <AlertTriangle className="h-3 w-3" /> Problemas
              </p>
              <ul className="space-y-0.5 text-red-800">
                {result.issues.map((s, i) => (
                  <li key={i} className="flex gap-1.5"><span>✕</span>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Sugestão */}
          {result.suggestion && (
            <div className="rounded-md bg-white/60 border border-gray-200 p-2 text-gray-700 italic">
              💡 {result.suggestion}
            </div>
          )}

          {/* Ações pós-análise */}
          <div className="flex items-center gap-2 pt-1 border-t border-current/10">
            <button
              type="button"
              onClick={improve}
              disabled={improving || loading}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                'bg-[#1877F2] text-white hover:bg-[#1565c0] disabled:opacity-50',
              )}
            >
              {improving
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Melhorando...</>
                : <><Wand2 className="h-3 w-3" /> Melhorar com IA</>}
            </button>
            {improved && (
              <button
                type="button"
                onClick={() => setShowImproved((v) => !v)}
                className="text-xs text-[#1877F2] hover:underline"
              >
                {showImproved ? 'Ocultar' : 'Ver'} versão melhorada
              </button>
            )}
          </div>
        </div>
      )}

      {/* Painel da copy melhorada */}
      {improved && showImproved && (
        <div className="rounded-lg border-2 border-[#1877F2] bg-blue-50 p-3 text-xs space-y-3">
          <p className="font-semibold text-[#1877F2] flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Copy melhorada pela IA
          </p>

          {/* Headline */}
          <div className="space-y-1">
            <div className="flex items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Headline</span>
              <CopyClipboard text={improved.headline} />
            </div>
            <p className="font-medium text-gray-900 leading-snug">{improved.headline}</p>
          </div>

          {/* Body */}
          <div className="space-y-1">
            <div className="flex items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Texto</span>
              <CopyClipboard text={improved.body} />
            </div>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{improved.body}</p>
          </div>

          {/* CTA */}
          <div className="space-y-1">
            <div className="flex items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">CTA</span>
              <CopyClipboard text={improved.cta} />
            </div>
            <span className="inline-block rounded-full bg-[#1877F2] px-3 py-1 text-white font-medium">
              {improved.cta}
            </span>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-2 pt-1 border-t border-blue-200">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(
                `Headline: ${improved.headline}\n\n${improved.body}\n\nCTA: ${improved.cta}`
              ).then(() => toast.success('Copy completa copiada!'))}
              className="flex items-center gap-1.5 rounded-lg border border-[#1877F2] px-3 py-1.5 text-xs font-medium text-[#1877F2] hover:bg-[#e7f0fd] transition-colors"
            >
              <Copy className="h-3 w-3" /> Copiar tudo
            </button>

            {onApplyImproved && (
              <button
                type="button"
                onClick={() => { onApplyImproved(improved); toast.success('Copy aplicada!'); }}
                className="flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1565c0] transition-colors"
              >
                <Check className="h-3 w-3" /> Usar esta copy
              </button>
            )}

            <button
              type="button"
              onClick={improve}
              disabled={improving}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {improving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Gerar outra versão
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Apenas a nota, sem o painel expandido — para uso em listas */
export function CopyScoreBadgeOnly({ score }: { score: number }) {
  return <ScoreBadge score={score} />;
}
