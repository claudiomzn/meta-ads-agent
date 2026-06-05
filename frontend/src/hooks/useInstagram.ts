import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/services/api';

export interface IGPost {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  permalink: string;
  insights?: {
    reach?: number;
    impressions?: number;
    engagement?: number;
    saved?: number;
  };
}

export interface IGAccount {
  id: string;
  name: string;
  username: string;
  followers_count: number;
  media_count: number;
  profile_picture_url?: string;
  biography?: string;
}

export interface IGAnalysis {
  summary: string;
  bestPosts: { id: string; reason: string }[];
  worstPosts: { id: string; reason: string }[];
  patterns: { title: string; insight: string; recommendation: string }[];
  bestTime: string;
  bestType: string;
  suggestions: string[];
}

export interface IGData {
  account: IGAccount;
  posts: IGPost[];
  analysis?: IGAnalysis;
}

export function useInstagramPosts() {
  return useQuery<IGData>({
    queryKey: ['instagram', 'posts'],
    queryFn: () => api.get<IGData>('/instagram/posts'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useInstagramAnalyze() {
  return useMutation<IGData, Error>({
    mutationFn: () => api.post<IGData>('/instagram/analyze'),
    onSuccess: () => toast.success('Análise do Instagram concluída!'),
    onError: (e: Error) => toast.error(`Erro na análise: ${e.message}`),
  });
}
