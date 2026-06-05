import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Palette } from 'lucide-react';
import { api } from '@/services/api';
import { CreativeScoreCard, type AnalysisResult } from '@/components/CreativeScoreCard';

interface CreativeRecord {
  id: string;
  fileName: string;
  filePath: string;
  overallScore: number;
  approvalRecommendation: string;
  approvalReason: string;
  summary: string;
  criteriaScores: AnalysisResult['criteria'];
  formatScores: AnalysisResult['formatScores'];
  strengths: string[];
  improvements: AnalysisResult['improvements'];
  copyHeadline: string | null;
  copyBody: string | null;
  copyCta: string | null;
  realCtr: number | null;
  realCpl: number | null;
  realRoas: number | null;
  realImpressions: number | null;
  isComparison: boolean;
  comparisonDetails: Record<string, unknown> | null;
  createdAt: string;
}

export default function CreativeDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery<CreativeRecord>({
    queryKey: ['creative-analysis', id],
    queryFn: () => api.get(`/creative-analysis/${id}`),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Carregando...</div>;
  if (!data) return <div className="text-destructive p-6">Análise não encontrada</div>;

  const analysis: AnalysisResult = {
    overallScore: data.overallScore,
    summary: data.summary,
    approvalRecommendation: data.approvalRecommendation as AnalysisResult['approvalRecommendation'],
    approvalReason: data.approvalReason,
    criteria: data.criteriaScores,
    formatScores: data.formatScores,
    strengths: data.strengths,
    improvements: data.improvements,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link to="/creative-analysis/history" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Histórico
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium truncate">{data.fileName}</span>
      </div>

      <div className="flex items-center gap-3">
        <Palette className="h-6 w-6 text-[#1877F2]" />
        <h1 className="text-xl font-bold truncate">{data.fileName}</h1>
        <span className="text-sm text-muted-foreground flex-shrink-0">
          {new Date(data.createdAt).toLocaleDateString('pt-BR')}
        </span>
      </div>

      {/* Métricas reais */}
      {(data.realCtr != null || data.realCpl != null || data.realRoas != null) && (
        <div className="grid gap-3 sm:grid-cols-4 rounded-xl border bg-green-50 border-green-200 p-4">
          <p className="text-xs font-semibold text-green-700 col-span-full">📊 Métricas reais sincronizadas</p>
          {data.realCtr != null && (
            <div className="text-center">
              <p className="text-xl font-black text-green-700">{data.realCtr.toFixed(2)}%</p>
              <p className="text-xs text-green-600">CTR</p>
            </div>
          )}
          {data.realCpl != null && (
            <div className="text-center">
              <p className="text-xl font-black text-green-700">R$ {data.realCpl.toFixed(0)}</p>
              <p className="text-xs text-green-600">CPL</p>
            </div>
          )}
          {data.realRoas != null && (
            <div className="text-center">
              <p className="text-xl font-black text-green-700">{data.realRoas.toFixed(2)}x</p>
              <p className="text-xs text-green-600">ROAS</p>
            </div>
          )}
          {data.realImpressions != null && (
            <div className="text-center">
              <p className="text-xl font-black text-green-700">{data.realImpressions.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-green-600">Impressões</p>
            </div>
          )}
        </div>
      )}

      {/* Copy vinculada */}
      {(data.copyHeadline || data.copyBody) && (
        <div className="rounded-lg border bg-gray-50 p-4 space-y-1.5 text-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Copy analisada</p>
          {data.copyHeadline && <p><strong>Headline:</strong> {data.copyHeadline}</p>}
          {data.copyBody && <p className="text-muted-foreground">{data.copyBody}</p>}
          {data.copyCta && <p><strong>CTA:</strong> {data.copyCta}</p>}
        </div>
      )}

      {/* Score card */}
      <CreativeScoreCard analysis={analysis} fileName={data.fileName} />
    </div>
  );
}
