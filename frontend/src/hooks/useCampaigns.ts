import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface AdRecord {
  id: string;
  name: string;
  headline: string;
  bodyText: string;
  cta: string;
  imageUrl?: string;
  metaAdId?: string;
  metaStatus?: string;
  metaCtr?: number;
  metaCpc?: number;
  metaSpend?: number;
}

export interface AdSetRecord {
  id: string;
  name: string;
  dailyBudget: number;
  targeting: string;
  optimizationGoal: string;
  metaAdSetId?: string;
  metaStatus?: string;
  metaSpend?: number;
  metaRoas?: number;
  metaCpl?: number;
  metaFrequency?: number;
  ads: AdRecord[];
}

export interface CampaignRecord {
  id: string;
  name: string;
  product: string;
  objective: string;
  budget: number;
  status: string;
  metaCampaignId?: string;
  metaAdAccountId?: string;
  metaStatus?: string;
  metaSpend?: number;
  metaRoas?: number;
  metaCpc?: number;
  metaCpl?: number;
  metaImpressions?: number;
  metaClicks?: number;
  publishedAt?: string;
  lastSyncAt?: string;
  adSets: AdSetRecord[];
  copies: unknown[];
  updatedAt: string;
}

export function useCampaigns() {
  return useQuery<CampaignRecord[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns'),
  });
}

export function useCampaign(id: string) {
  return useQuery<CampaignRecord>({
    queryKey: ['campaigns', id],
    queryFn: () => api.get(`/campaigns/${id}`),
    enabled: !!id,
  });
}

interface AdInput {
  name: string;
  headline: string;
  bodyText: string;
  cta: string;
  imageUrl?: string;
}

interface AdSetInput {
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  ads: AdInput[];
}

interface CreateCampaignInput {
  name: string;
  product: string;
  objective: string;
  budget: number;
  adSets?: AdSetInput[];
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCampaignInput) =>
      api.post<CampaignRecord>('/campaigns', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useUpdateCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CampaignRecord>) => api.put<CampaignRecord>(`/campaigns/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}
