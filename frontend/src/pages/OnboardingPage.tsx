import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Circle, ExternalLink, Loader2 } from 'lucide-react';
import { useMCPConnect } from '@/hooks/useMCP';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Provider = 'pipeboard' | 'meta' | 'zapier';

const PROVIDERS = [
  {
    id: 'pipeboard' as Provider,
    name: 'Pipeboard',
    tag: 'Recomendado',
    description: 'Mais fácil, 5 minutos, plano gratuito disponível',
    url: 'https://pipeboard.co',
    placeholder: 'https://meta-ads.mcp.pipeboard.co/',
  },
  {
    id: 'meta' as Provider,
    name: 'MCP Oficial Meta',
    description: 'Direto da fonte, requer app Meta aprovado',
    url: 'https://developers.facebook.com',
    placeholder: 'https://[url-do-meta-business-help-center]',
  },
  {
    id: 'zapier' as Provider,
    name: 'Zapier MCP',
    description: 'Sem código, conecta em 2 minutos',
    url: 'https://zapier.com/mcp',
    placeholder: 'https://mcp.zapier.com/api/mcp/s/[seu-id]/mcp',
  },
];

const STEPS = ['Escolher servidor MCP', 'URL do servidor', 'Token de acesso Meta', 'Contas de anúncios', 'Sincronização inicial'];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<Provider>('pipeboard');
  const [mcpUrl, setMcpUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountIds, setAccountIds] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const connect = useMCPConnect();
  const navigate = useNavigate();

  async function testConnection() {
    setTestResult('testing');
    setError('');
    try {
      await api.get(`/mcp/status`);
      setTestResult('ok');
    } catch {
      setTestResult('error');
      setError('Não foi possível alcançar o servidor MCP. Verifique a URL.');
    }
  }

  async function finish() {
    setError('');
    try {
      const ids = accountIds.split(',').map((s) => s.trim()).filter(Boolean);
      await connect.mutateAsync({
        accessToken,
        mcpUrl,
        mcpProvider: provider,
        adAccountIds: ids,
      });

      // Importa campanhas existentes
      for (const id of ids) {
        await api.post('/mcp/import', { adAccountId: id }).catch(() => null);
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar');
    }
  }

  const selectedProvider = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-2xl space-y-6 px-4">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1877F2]">
            <span className="text-2xl font-bold text-white">f</span>
          </div>
          <h1 className="text-2xl font-bold">Configuração inicial</h1>
          <p className="mt-1 text-muted-foreground">Conecte sua conta de anúncios em 5 passos</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors',
                i < step ? 'bg-green-500 text-white' : i === step ? 'bg-[#1877F2] text-white' : 'bg-gray-200 text-gray-500',
              )}>
                {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span className={cn('hidden text-center text-[10px] leading-tight md:block', i === step ? 'text-[#1877F2] font-medium' : 'text-muted-foreground')}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <Card>
          <CardHeader>
            <CardTitle>Passo {step + 1} — {STEPS[step]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Step 0 — escolher provider */}
            {step === 0 && (
              <div className="grid gap-3">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setProvider(p.id); setMcpUrl(p.placeholder); }}
                    className={cn(
                      'flex items-start gap-4 rounded-lg border p-4 text-left transition-colors',
                      provider === p.id ? 'border-[#1877F2] bg-[#e7f0fd]' : 'hover:bg-gray-50',
                    )}
                  >
                    <div className={cn('mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0', provider === p.id ? 'border-[#1877F2] bg-[#1877F2]' : 'border-gray-300')} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.tag && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{p.tag}</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{p.description}</p>
                      <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#1877F2] hover:underline" onClick={(e) => e.stopPropagation()}>
                        Abrir site <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 1 — URL */}
            {step === 1 && (
              <div className="space-y-3">
                <CardDescription>Cole a URL do servidor MCP do {selectedProvider.name}</CardDescription>
                <Input
                  placeholder={selectedProvider.placeholder}
                  value={mcpUrl}
                  onChange={(e) => { setMcpUrl(e.target.value); setTestResult('idle'); }}
                />
                <Button variant="outline" size="sm" onClick={testConnection} disabled={!mcpUrl || testResult === 'testing'}>
                  {testResult === 'testing' && <Loader2 className="h-4 w-4 animate-spin" />}
                  {testResult === 'ok' ? '✅ Conexão ok!' : testResult === 'error' ? '❌ Falhou' : 'Testar conexão'}
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            {/* Step 2 — Token */}
            {step === 2 && (
              <div className="space-y-3">
                {provider === 'meta' ? (
                  <>
                    <CardDescription>
                      Cole o seu <strong>Token de Acesso do Meta</strong> (User Access Token com permissões: ads_management, ads_read, business_management)
                    </CardDescription>
                    <Input
                      type="password"
                      placeholder="EAABwzLixnjY..."
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                    />
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[#1877F2] hover:underline">
                      Gerar token no Graph Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                ) : (
                  <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
                    <p className="font-medium text-green-800">✅ Token não necessário</p>
                    <p className="text-sm text-green-700">
                      O <strong>{selectedProvider.name}</strong> já cuida da autenticação com o Meta internamente.
                      Sua conta Meta já está conectada ao {selectedProvider.name} — não precisa de token separado.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — Contas */}
            {step === 3 && (
              <div className="space-y-3">
                <CardDescription>
                  Cole os IDs das contas de anúncios que deseja monitorar (separados por vírgula). Ex: <code className="text-xs bg-gray-100 px-1 rounded">act_123456789, act_987654321</code>
                </CardDescription>
                <Input
                  placeholder="act_123456789, act_987654321"
                  value={accountIds}
                  onChange={(e) => setAccountIds(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Encontre os IDs em: Gerenciador de Negócios → Configurações → Contas de Anúncios</p>
              </div>
            )}

            {/* Step 4 — Finalizar */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="rounded-lg bg-[#e7f0fd] p-4 space-y-2">
                  <p className="font-medium text-[#1877F2]">Resumo da configuração</p>
                  <div className="text-sm space-y-1">
                    <div className="flex gap-2"><Circle className="h-4 w-4 text-[#1877F2] mt-0.5" /><span>Servidor: <strong>{selectedProvider.name}</strong></span></div>
                    <div className="flex gap-2"><Circle className="h-4 w-4 text-[#1877F2] mt-0.5" /><span>URL: <strong className="text-xs">{mcpUrl}</strong></span></div>
                    <div className="flex gap-2"><Circle className="h-4 w-4 text-[#1877F2] mt-0.5" /><span>Contas: <strong>{accountIds}</strong></span></div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Ao finalizar, as campanhas existentes serão importadas automaticamente.</p>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
                Voltar
              </Button>
              {step < 4 ? (
                <Button
                  variant="meta"
                  onClick={() => setStep((s) => s + 1)}
                  disabled={
                    (step === 1 && !mcpUrl) ||
                    (step === 2 && provider === 'meta' && !accessToken) ||
                    (step === 3 && !accountIds)
                  }
                >
                  Próximo
                </Button>
              ) : (
                <Button variant="meta" onClick={finish} disabled={connect.isPending}>
                  {connect.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Conectando...</> : 'Finalizar configuração'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
