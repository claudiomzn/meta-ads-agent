import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, X, Play, Loader2, Trash2, ToggleLeft, ToggleRight, Clock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/services/api';
import { useMCPStatus } from '@/hooks/useMCP';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface CampaignOption {
  id: string;
  name: string;
  metaCampaignId?: string | null;
}

interface RuleLog {
  id: string;
  action: string;
  metrics?: string;
  executedAt: string;
}

interface AutomationRule {
  id: string;
  name: string;
  targetId: string;
  targetType: string;
  trigger: string;
  condition: string;
  value: number;
  window: number;
  action: string;
  active: boolean;
  lastChecked?: string;
  logs: RuleLog[];
}

interface RunResult {
  conditionMet: boolean;
  executed: boolean;
  metricValue: number;
  threshold: number;
  condition: string;
}

const TRIGGERS = [
  { value: 'roas', label: 'ROAS' },
  { value: 'cpc', label: 'CPC (R$)' },
  { value: 'cpl', label: 'CPL (R$)' },
  { value: 'ctr', label: 'CTR (%)' },
  { value: 'frequency', label: 'Frequência' },
  { value: 'spend', label: 'Gasto (R$)' },
];

const CONDITIONS = [
  { value: 'gt', label: 'maior que' },
  { value: 'lt', label: 'menor que' },
  { value: 'gte', label: 'maior ou igual a' },
  { value: 'lte', label: 'menor ou igual a' },
];

const ACTIONS = [
  { value: 'PAUSE', label: 'Pausar', color: 'text-red-600', bg: 'bg-red-50' },
  { value: 'ACTIVATE', label: 'Ativar', color: 'text-green-600', bg: 'bg-green-50' },
  { value: 'SCALE_UP', label: 'Escalar +20%', color: 'text-blue-600', bg: 'bg-blue-50' },
  { value: 'SCALE_DOWN', label: 'Reduzir -20%', color: 'text-orange-600', bg: 'bg-orange-50' },
  { value: 'ALERT', label: 'Enviar alerta', color: 'text-purple-600', bg: 'bg-purple-50' },
];

const TARGET_TYPES = [
  { value: 'campaign', label: 'Campanha' },
  { value: 'adset', label: 'Conjunto de anúncios' },
  { value: 'ad', label: 'Anúncio' },
];

function RuleCard({ rule, onToggle, onDelete, onRun }: {
  rule: AutomationRule;
  onToggle: () => void;
  onDelete: () => void;
  onRun: () => Promise<RunResult>;
}) {
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  const triggerLabel = TRIGGERS.find((t) => t.value === rule.trigger)?.label ?? rule.trigger;
  const conditionLabel = CONDITIONS.find((c) => c.value === rule.condition)?.label ?? rule.condition;
  const actionInfo = ACTIONS.find((a) => a.value === rule.action);

  async function handleRun() {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await onRun();
      setRunResult(result);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={cn('rounded-xl border bg-white overflow-hidden transition-shadow hover:shadow-sm', !rule.active && 'opacity-60')}>
      <div className="flex items-start gap-4 p-5">
        {/* Toggle */}
        <button onClick={onToggle} className="mt-0.5 flex-shrink-0">
          {rule.active
            ? <ToggleRight className="h-6 w-6 text-[#1877F2]" />
            : <ToggleLeft className="h-6 w-6 text-gray-400" />
          }
        </button>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{rule.name}</span>
            <Badge variant={rule.active ? 'success' : 'secondary'}>
              {rule.active ? 'Ativa' : 'Inativa'}
            </Badge>
            {actionInfo && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', actionInfo.bg, actionInfo.color)}>
                {actionInfo.label}
              </span>
            )}
          </div>

          {/* Condição */}
          <p className="text-sm text-muted-foreground">
            Se <strong>{triggerLabel}</strong> for <strong>{conditionLabel} {rule.value}</strong> nos últimos <strong>{rule.window} dias</strong> → <strong className={actionInfo?.color}>{actionInfo?.label}</strong> o {rule.targetType}
          </p>

          {/* Última verificação */}
          {rule.lastChecked && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Último check: {new Date(rule.lastChecked).toLocaleString('pt-BR')}
            </div>
          )}

          {/* Resultado do test run */}
          {runResult && (
            <div className={cn('rounded-lg px-3 py-2 text-xs font-medium', runResult.conditionMet ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600')}>
              {runResult.conditionMet
                ? `✅ Condição atingida — ${triggerLabel} = ${runResult.metricValue.toFixed(2)} (threshold: ${runResult.threshold}) → Ação ${runResult.executed ? 'executada' : 'simulada'}`
                : `➡️ Condição não atingida — ${triggerLabel} = ${runResult.metricValue.toFixed(2)} (threshold: ${runResult.threshold})`
              }
            </div>
          )}

          {/* Logs recentes */}
          {expanded && rule.logs.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Histórico de execuções</p>
              {rule.logs.map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-xs text-gray-600">
                  <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                  <span className="font-medium">{log.action}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{new Date(log.executedAt).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {rule.logs.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} className="rounded p-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100">
              {rule.logs.length} log(s)
            </button>
          )}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Testar
          </Button>
          <button onClick={onDelete} className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormData {
  name: string;
  targetId: string;
  targetType: string;
  trigger: string;
  condition: string;
  value: string;
  window: string;
  action: string;
  alertEmail: string;
}

const EMPTY: FormData = {
  name: '',
  targetId: '',
  targetType: 'adset',
  trigger: 'frequency',
  condition: 'gt',
  value: '3.5',
  window: '7',
  action: 'PAUSE',
  alertEmail: '',
};

const PRESETS = [
  { name: 'Pausar se frequência alta', trigger: 'frequency', condition: 'gt', value: '3.5', action: 'PAUSE', targetType: 'adset', window: '7' },
  { name: 'Escalar se ROAS alto', trigger: 'roas', condition: 'gte', value: '5', action: 'SCALE_UP', targetType: 'campaign', window: '3' },
  { name: 'Pausar se CTR baixo', trigger: 'ctr', condition: 'lt', value: '0.8', action: 'PAUSE', targetType: 'ad', window: '3' },
  { name: 'Alerta se gasto alto', trigger: 'spend', condition: 'gt', value: '1000', action: 'ALERT', targetType: 'campaign', window: '1' },
];

export default function AutomationsPage() {
  const qc = useQueryClient();
  const { data: mcpStatus } = useMCPStatus();
  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['automations'],
    queryFn: () => api.get('/automations'),
  });
  const { data: campaigns = [] } = useQuery<CampaignOption[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY);

  const createMutation = useMutation({
    mutationFn: (data: Omit<FormData, 'value' | 'window'> & { value: number; window: number }) =>
      api.post('/automations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      setShowForm(false);
      setForm(EMPTY);
      toast.success('Automação criada!');
    },
    onError: (e: Error) => toast.error(`Erro ao criar automação: ${e.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/automations/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
    onError: (e: Error) => toast.error(`Erro ao alterar automação: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/automations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automação removida.');
    },
    onError: (e: Error) => toast.error(`Erro ao remover: ${e.message}`),
  });

  function set(field: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function applyPreset(preset: typeof PRESETS[0]) {
    setForm((f) => ({ ...f, ...preset, value: String(preset.value), window: String(preset.window), name: preset.name }));
    setShowForm(true);
  }

  function save() {
    if (!form.name || !form.targetId) return;
    createMutation.mutate({ ...form, value: Number(form.value), window: Number(form.window) });
  }

  async function runRule(id: string): Promise<RunResult> {
    return api.post<RunResult>(`/automations/${id}/run`);
  }

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automações</h1>
          <p className="text-muted-foreground">{activeCount} regra(s) ativa(s) · verificação a cada 15 minutos</p>
        </div>
        <Button variant="meta" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Fechar' : 'Nova regra'}
        </Button>
      </div>

      {/* Aviso MCP desconectado */}
      {!mcpStatus?.connected && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 flex items-center justify-between">
          <p className="text-sm text-yellow-800">
            <strong>Meta Ads desconectado</strong> — as automações só executam ações reais quando conectado.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/onboarding">Conectar</Link>
          </Button>
        </div>
      )}

      {/* Presets */}
      {!showForm && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Começar com um modelo pronto:</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PRESETS.map((p) => {
              const actionInfo = ACTIONS.find((a) => a.value === p.action)!;
              return (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className="rounded-lg border border-dashed p-3 text-left hover:border-[#1877F2] hover:bg-[#e7f0fd] transition-colors group"
                >
                  <p className="text-sm font-medium group-hover:text-[#1877F2]">{p.name}</p>
                  <p className={cn('mt-1 text-xs font-medium', actionInfo.color)}>{actionInfo.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm && (
        <Card className="border-[#1877F2]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Criar regra de automação</CardTitle>
            <CardDescription>A regra será verificada a cada 15 minutos e executará no Meta Ads real quando ativa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome da regra *</label>
              <Input placeholder="Ex: Pausar se frequência alta" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>

            <div className="rounded-lg bg-gray-50 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Condição SE...</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Métrica</label>
                  <Select value={form.trigger} onValueChange={(v) => set('trigger', v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Condição</label>
                  <Select value={form.condition} onValueChange={(v) => set('condition', v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Valor</label>
                  <Input className="h-9" type="number" step="0.1" value={form.value} onChange={(e) => set('value', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Janela (dias)</label>
                  <Input className="h-9" type="number" min={1} max={90} value={form.window} onChange={(e) => set('window', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ação ENTÃO...</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Ação</label>
                  <Select value={form.action} onValueChange={(v) => set('action', v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          <span className={a.color}>{a.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Tipo de alvo</label>
                  <Select value={form.targetType} onValueChange={(v) => set('targetType', v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TARGET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Campanha *</label>
                  <Select
                    value={form.targetId}
                    onValueChange={(v) => set('targetId', v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={campaigns.length === 0 ? 'Nenhuma campanha' : 'Escolha...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.metaCampaignId ?? c.id}>
                          {c.name}
                          {!c.metaCampaignId && <span className="ml-1.5 text-xs text-gray-400">(rascunho)</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {campaigns.length === 0 && (
                    <p className="text-xs text-muted-foreground">Crie uma campanha primeiro.</p>
                  )}
                </div>
              </div>
              {form.action === 'ALERT' && (
                <Input placeholder="E-mail para alerta" value={form.alertEmail} onChange={(e) => set('alertEmail', e.target.value)} />
              )}
            </div>

            {/* Preview da regra */}
            {form.name && form.targetId && (
              <div className="rounded-lg border border-[#1877F2]/20 bg-[#e7f0fd] px-4 py-3 text-sm text-[#1877F2]">
                <strong>Resumo:</strong> Se <strong>{TRIGGERS.find(t => t.value === form.trigger)?.label}</strong> for{' '}
                <strong>{CONDITIONS.find(c => c.value === form.condition)?.label} {form.value}</strong> nos últimos{' '}
                <strong>{form.window} dias</strong> → <strong>{ACTIONS.find(a => a.value === form.action)?.label}</strong> o {form.targetType}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY); }}>Cancelar</Button>
              <Button variant="meta" onClick={save} disabled={!form.name || !form.targetId || createMutation.isPending}>
                {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Criando...</> : 'Criar regra'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de regras */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl border bg-gray-100 animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Bot className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-500">Nenhuma automação criada</p>
          <p className="mt-1 text-sm text-muted-foreground">Crie regras para pausar, ativar e escalar campanhas automaticamente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => toggleMutation.mutate(rule.id)}
              onDelete={() => { if (confirm(`Deletar regra "${rule.name}"?`)) deleteMutation.mutate(rule.id); }}
              onRun={() => runRule(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
