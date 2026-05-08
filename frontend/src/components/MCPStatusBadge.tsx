import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useMCPStatus, useSyncNow } from '@/hooks/useMCP';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function MCPStatusBadge() {
  const { data: status, isLoading } = useMCPStatus();
  const sync = useSyncNow();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Verificando...
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600">
        <div className="h-2 w-2 rounded-full bg-red-500" />
        <WifiOff className="h-3.5 w-3.5" />
        Desconectado
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-green-700">
        <div className={cn('h-2 w-2 rounded-full bg-green-500', sync.isPending && 'animate-pulse')} />
        <Wifi className="h-3.5 w-3.5" />
        Meta Ads conectado
        {status.adAccountIds.length > 0 && (
          <span className="text-muted-foreground">· {status.adAccountIds.length} conta(s)</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => sync.mutate()}
        disabled={sync.isPending}
      >
        <RefreshCw className={cn('h-3 w-3', sync.isPending && 'animate-spin')} />
        {sync.isPending ? 'Sincronizando...' : 'Sincronizar'}
      </Button>
    </div>
  );
}
