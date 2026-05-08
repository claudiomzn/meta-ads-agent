import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface MCPStatus {
  connected: boolean;
  provider?: string;
  mcpUrl?: string;
  adAccountIds: string[];
  lastConnectedAt?: string;
}

export function useMCPStatus() {
  return useQuery<MCPStatus>({
    queryKey: ['mcp-status'],
    queryFn: () => api.get('/mcp/status'),
    refetchInterval: 30_000,
  });
}

export function useMCPConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      accessToken: string;
      mcpUrl: string;
      mcpProvider: 'meta' | 'pipeboard' | 'zapier';
      adAccountIds: string[];
    }) => api.post('/mcp/connect', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-status'] }),
  });
}

export function useMCPDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/mcp/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-status'] }),
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/mcp/sync/now'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}
