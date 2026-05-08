import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wifi, WifiOff, RefreshCw, LogOut, ExternalLink, Clock, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { useMCPStatus, useMCPDisconnect, useSyncNow } from '@/hooks/useMCP';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';

interface SyncLog {
  id: string;
  type: string;
  status: string;
  details?: string;
  duration?: number;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  metrics: 'Métricas',
  status: 'Status',
  import: 'Importação',
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: mcpStatus, isLoading: statusLoading } = useMCPStatus();
  const disconnect = useMCPDisconnect();
  const sync = useSyncNow();

  const { data: syncLogs = [] } = useQuery<SyncLog[]>({
    queryKey: ['sync-logs'],
    queryFn: () => api.get('/mcp/sync/log'),
    enabled: !!mcpStatus?.connected,
  });

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function handleDisconnect() {
    await disconnect.mutateAsync();
    setConfirmDisconnect(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Gerencie sua conta e conexão com o Meta Ads</p>
      </div>

      {/* Conta */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{user?.name}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Conexão MCP */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conexão Meta Ads</CardTitle>
          <CardDescription>Status da integração via MCP com sua conta de anúncios</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Verificando conexão...
            </div>
          ) : mcpStatus?.connected ? (
            <>
              {/* Status conectado */}
              <div className="flex items-center justify-between rounded-lg border bg-green-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Conectado</p>
                    {mcpStatus.provider && (
                      <p className="text-xs text-green-600">via {mcpStatus.provider}</p>
                    )}
                  </div>
                </div>
                <Wifi className="h-5 w-5 text-green-600" />
              </div>

              {/* Contas ativas */}
              {mcpStatus.adAccountIds.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Contas de anúncios monitoradas</p>
                  <div className="space-y-1.5">
                    {mcpStatus.adAccountIds.map((id) => (
                      <div key={id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-sm font-mono">{id}</span>
                        </div>
                        <a
                          href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${id.replace('act_', '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#1877F2] hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Gerenciador
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Última sincronização */}
              {mcpStatus.lastConnectedAt && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Última conexão: {new Date(mcpStatus.lastConnectedAt).toLocaleString('pt-BR')}
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-3">
                <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending} className="gap-2">
                  <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
                  {sync.isPending ? 'Sincronizando...' : 'Sincronizar agora'}
                </Button>

                {!confirmDisconnect ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                    <WifiOff className="h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600">Confirmar desconexão?</span>
                    <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnect.isPending}>
                      {disconnect.isPending ? 'Desconectando...' : 'Sim, desconectar'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>Cancelar</Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-gray-50 px-4 py-3">
                <WifiOff className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Meta Ads não conectado</p>
                  <p className="text-xs text-muted-foreground">Configure a integração para publicar campanhas e ver métricas reais</p>
                </div>
              </div>
              <Button asChild variant="meta">
                <Link to="/onboarding">Configurar integração</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico de sincronizações */}
      {mcpStatus?.connected && syncLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de sincronizações</CardTitle>
            <CardDescription>Últimas 50 operações de sync</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {syncLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-md border px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {log.status === 'success'
                      ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      : <XCircle className="h-3.5 w-3.5 text-red-500" />
                    }
                    <div>
                      <span className="text-sm font-medium">{TYPE_LABELS[log.type] ?? log.type}</span>
                      {log.details && (
                        <p className="text-xs text-muted-foreground truncate max-w-xs">{log.details}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {log.duration && <span>{log.duration}ms</span>}
                    <span>{new Date(log.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <Badge variant={log.status === 'success' ? 'success' : 'destructive'} className="text-xs">
                      {log.status === 'success' ? 'OK' : 'Erro'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sobre */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sobre o sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Versão</span>
            <span className="font-medium text-foreground">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span>Sincronização de métricas</span>
            <span className="font-medium text-foreground">A cada 1 hora</span>
          </div>
          <div className="flex justify-between">
            <span>Verificação de automações</span>
            <span className="font-medium text-foreground">A cada 15 minutos</span>
          </div>
          <div className="flex justify-between">
            <span>IA utilizada</span>
            <span className="font-medium text-foreground">Claude Sonnet 4.6</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
