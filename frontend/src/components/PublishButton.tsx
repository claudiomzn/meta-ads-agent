import { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ExternalLink, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import type { CampaignRecord } from '@/hooks/useCampaigns';

interface DryRunResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface PublishResult {
  success: boolean;
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  managerUrl: string;
}

type Phase = 'idle' | 'preflight' | 'preview' | 'publishing' | 'done' | 'error';

interface Props {
  campaign: CampaignRecord;
  adAccountId: string;
  destinationUrl: string;
  onDone?: (result: PublishResult) => void;
}

export function PublishButton({ campaign, adAccountId, destinationUrl, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [logs, setLogs] = useState<{ text: string; status: 'ok' | 'pending' | 'error' }[]>([]);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState('');
  const [pausedByDefault, setPausedByDefault] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function runPreflight() {
    setPhase('preflight');
    setError('');
    try {
      const plan = buildPlan();
      const result = await api.post<DryRunResult>('/mcp/publish/dry-run', plan);
      setDryRun(result);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na validação');
      setPhase('error');
    }
  }

  function buildPlan() {
    return {
      localId: campaign.id,
      adAccountId,
      name: campaign.name,
      objective: campaign.objective,
      destinationUrl,
      adSets: campaign.adSets.map((as) => ({
        name: as.name,
        dailyBudget: as.dailyBudget,
        targeting: JSON.parse(as.targeting),
        optimizationGoal: as.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        ads: as.ads.map((ad) => ({
          name: ad.name,
          headline: ad.headline,
          bodyText: ad.bodyText,
          ctaType: ad.cta,
          // Usa URL do anúncio (ex: WhatsApp) se disponível; fallback para a URL global
          destinationUrl: ad.destinationUrl || destinationUrl,
          imageUrl: ad.imageUrl,
        })),
      })),
    };
  }

  function publish() {
    setPhase('publishing');
    setLogs([]);
    setError('');

    const token = localStorage.getItem('token');
    const es = new EventSource(
      `/api/mcp/publish/${campaign.id}?adAccountId=${adAccountId}&destinationUrl=${encodeURIComponent(destinationUrl)}`,
    );

    // SSE não suporta headers no EventSource nativo; usamos fetch com ReadableStream
    es.close();

    const ctrl = new AbortController();
    fetch(`/api/mcp/publish/${campaign.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ adAccountId, destinationUrl }),
      signal: ctrl.signal,
    }).then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '');
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as {
              type: string;
              message?: string;
              result?: PublishResult;
              errors?: string[];
            };
            if (evt.type === 'progress' && evt.message) {
              const isOk = evt.message.startsWith('✅');
              const isErr = evt.message.startsWith('❌');
              setLogs((prev) => [
                ...prev.filter((l) => l.status !== 'pending'),
                { text: evt.message!, status: isOk ? 'ok' : isErr ? 'error' : 'pending' },
              ]);
            } else if (evt.type === 'done' && evt.result) {
              setResult(evt.result);
              setPhase('done');
              onDone?.(evt.result);
              toast.success('Campanha publicada no Meta Ads!');
            } else if (evt.type === 'error') {
              const msg = evt.errors?.join(', ') ?? evt.message ?? 'Erro';
              setError(msg);
              setPhase('error');
              toast.error(`Falha na publicação: ${msg}`);
            }
          } catch { /* ignora linha inválida */ }
        }
      }
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(String(err));
        setPhase('error');
      }
    });

    return () => ctrl.abort();
  }

  if (phase === 'idle') {
    return (
      <Button variant="meta" onClick={runPreflight} className="gap-2">
        <Play className="h-4 w-4" />
        Publicar no Meta Ads
      </Button>
    );
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b bg-[#1877F2] px-6 py-4">
        <h3 className="font-semibold text-white">
          {phase === 'preflight' && 'Validando campanha...'}
          {phase === 'preview' && 'Pronto para publicar'}
          {phase === 'publishing' && 'Publicando no Meta Ads...'}
          {phase === 'done' && '🎉 Publicado com sucesso!'}
          {phase === 'error' && 'Erro na publicação'}
        </h3>
      </div>

      <div className="p-6 space-y-5">
        {/* Preflight */}
        {phase === 'preflight' && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-[#1877F2]" />
            Verificando pixel, orçamento, URLs e textos...
          </div>
        )}

        {/* Preview */}
        {(phase === 'preview' || phase === 'publishing' || phase === 'done') && dryRun && (
          <div className="space-y-4">
            {/* Resultado da validação */}
            <div className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium',
              dryRun.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800',
            )}>
              {dryRun.valid
                ? <><CheckCircle className="h-4 w-4" /> Pronto para publicar</>
                : <><XCircle className="h-4 w-4" /> {dryRun.errors.length} erro(s) encontrado(s)</>
              }
            </div>

            {dryRun.errors.map((e, i) => (
              <div key={i} className="flex gap-2 text-sm text-red-700"><XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{e}</div>
            ))}
            {dryRun.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 text-sm text-yellow-700"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />{w}</div>
            ))}

            {/* Estrutura da campanha */}
            {phase === 'preview' && (
              <div className="rounded-lg border bg-gray-50 p-4 font-mono text-xs space-y-1">
                <div className="font-semibold text-gray-700">📣 {campaign.name}</div>
                {campaign.adSets.map((as) => (
                  <div key={as.id} className="ml-4">
                    <div className="text-gray-600">└── 📦 {as.name} — R$ {as.dailyBudget}/dia</div>
                    {as.ads.map((ad) => (
                      <div key={ad.id} className="ml-8 text-gray-500">└── 🖼 {ad.name}: "{ad.headline}"</div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Aviso suave: score de copy */}
            {phase === 'preview' && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-xs text-yellow-800">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-yellow-500" />
                <span>
                  <strong>Dica:</strong> analise suas copies com IA antes de publicar.
                  Acesse a página de detalhe da campanha → cada anúncio tem o botão{' '}
                  <em>"Score IA"</em>. Copies abaixo de 5.0 tendem a ter CTR baixo.
                </span>
              </div>
            )}

            {/* Checkbox pausado */}
            {phase === 'preview' && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={pausedByDefault}
                  onChange={(e) => setPausedByDefault(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Criar tudo como <strong>PAUSADO</strong> para revisão antes de ativar
              </label>
            )}
          </div>
        )}

        {/* Progresso em tempo real */}
        {(phase === 'publishing' || phase === 'done') && (
          <div className="rounded-lg border bg-gray-50 p-4 font-mono text-xs space-y-1.5 max-h-48 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={cn(
                'flex items-start gap-2',
                l.status === 'ok' ? 'text-green-700' : l.status === 'error' ? 'text-red-600' : 'text-gray-500',
              )}>
                {l.status === 'ok' && <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                {l.status === 'pending' && <Loader2 className="h-3 w-3 mt-0.5 flex-shrink-0 animate-spin" />}
                {l.status === 'error' && <XCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                {l.text}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {/* Sucesso */}
        {phase === 'done' && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg bg-green-50 p-3">
                <div className="text-lg font-bold text-green-700">1</div>
                <div className="text-xs text-green-600">Campanha</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="text-lg font-bold text-green-700">{result.adSetIds.length}</div>
                <div className="text-xs text-green-600">Conjuntos</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="text-lg font-bold text-green-700">{result.adIds.length}</div>
                <div className="text-xs text-green-600">Anúncios</div>
              </div>
            </div>
            <a
              href={result.managerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-[#1877F2] px-4 py-2 text-sm font-medium text-[#1877F2] hover:bg-[#e7f0fd] transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Gerenciador de Anúncios
            </a>
          </div>
        )}

        {/* Erro */}
        {phase === 'error' && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Ações */}
        <div className="flex justify-between pt-1">
          {phase !== 'done' && phase !== 'publishing' && (
            <Button variant="outline" size="sm" onClick={() => { setPhase('idle'); setDryRun(null); setError(''); }}>
              Cancelar
            </Button>
          )}
          <div className="ml-auto">
            {phase === 'preview' && dryRun?.valid && (
              <Button variant="meta" onClick={publish}>
                Publicar agora
              </Button>
            )}
            {phase === 'error' && (
              <Button variant="meta" onClick={runPreflight}>
                Tentar novamente
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
