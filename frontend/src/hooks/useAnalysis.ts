import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/services/api';

interface InsightSummary {
  id: string;
  type: string;
  title: string;
  summary: string;
  campaignsCount: number;
  createdAt: string;
}

export interface Winner {
  campaignId: string;
  name: string;
  roas: number | null;
  cpl: number | null;
  reasons: string[];
}

export interface Loser {
  campaignId: string;
  name: string;
  roas: number | null;
  lessons: string[];
}

export interface Pattern {
  category: string;
  insight: string;
  recommendation: string;
}

export interface AdSuggestion {
  name: string;
  headline: string;
  bodyText: string;
  ctaType: string;
  destinationUrl: string;
}

export interface AdSetSuggestion {
  name: string;
  dailyBudget: number;
  optimizationGoal: string;
  billingEvent: string;
  targeting: Record<string, unknown>;
  rationale: string;
  ads: AdSuggestion[];
}

export interface CampaignSuggestion {
  name: string;
  rationale: string;
  product: string;
  objective: string;
  budget: number;
  adSets: AdSetSuggestion[];
}

export interface FullAnalysis {
  summary: string;
  totalSpend: number;
  avgRoas: number | null;
  winners: Winner[];
  losers: Loser[];
  patterns: Pattern[];
  suggestions: CampaignSuggestion[];
}

export function useInsights() {
  return useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get<InsightSummary[]>('/analysis'),
  });
}

export function useInsightDetail(id: string | null) {
  return useQuery({
    queryKey: ['insights', id],
    queryFn: () =>
      api.get<InsightSummary & { content: FullAnalysis }>(`/analysis/${id}`),
    enabled: !!id,
  });
}

export function useRunAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<FullAnalysis>('/analysis/run', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights'] });
      toast.success('Análise IA concluída!');
    },
    onError: (e: Error) => toast.error(`Erro na análise: ${e.message}`),
  });
}
