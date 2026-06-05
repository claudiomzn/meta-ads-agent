import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-status'] });
      toast.success('Meta Ads conectado com sucesso!');
    },
    onError: (e: Error) => toast.error(`Falha na conexão: ${e.message}`),
  });
}

export function useMCPDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/mcp/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-status'] });
      toast.info('Meta Ads desconectado.');
    },
    onError: (e: Error) => toast.error(`Erro ao desconectar: ${e.message}`),
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/mcp/sync/now'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Sincronização concluída!');
    },
    onError: (e: Error) => toast.error(`Erro na sincronização: ${e.message}`),
  });
}
