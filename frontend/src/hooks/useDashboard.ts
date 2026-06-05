import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface DailyMetric {
  date: string;       // YYYY-MM-DD
  label: string;      // DD/MM (para exibição)
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  activeCampaigns: number;
}

export interface DashboardSummary {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  activeCampaigns: number;
  avgRoas: number | null;
  ctr: number | null;
  lastSyncAt: string | null;
}

export function useChartData(days = 30) {
  return useQuery<DailyMetric[]>({
    queryKey: ['dashboard', 'chart', days],
    queryFn: () => api.get(`/dashboard/chart?days=${days}`),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get('/dashboard/summary'),
    staleTime: 5 * 60 * 1000,
  });
}
