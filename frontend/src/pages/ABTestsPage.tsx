import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FlaskConical, Loader2, X, Trophy, TrendingUp } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency } from '@/lib/utils';

interface ABTest {
  id: string;
  name: string;
  hypothesis: string;
  variable: string;
  variantA: string;
  variantB: string;
  budget: number;
  duration: number;
  metric: string;
  status: string;
  winner?: string;
  createdAt: string;
}

const VARIABLES = ['Headline', 'Imagem', 'Copy do corpo', 'CTA', 'Segmentação', 'Formato do anúncio'];
const METRICS = ['CTR', 'CPC', 'CPL', 'ROAS', 'Taxa de conversão'];

// Calculadora de significância estatística (teste Z bilateral)
function calcSignificance(n1: number, c1: number, n2: number, c2: number): { significant: boolean; confidence: number; winner: 'A' | 'B' | null } {
  if (n1 < 100 || n2 < 100) return { significant: false, confidence: 0, winner: null };
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pPool = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { significant: false, confidence: 0, winner: null };
  const z = Math.abs(p1 - p2) / se;
  // Z > 1.96 → 95% confiança
  const confidence = z > 2.576 ? 99 : z > 1.96 ? 95 : z > 1.645 ? 90 : Math.round(z / 1.96 * 95);
  return {
    significant: z > 1.96,
    confidence,
    winner: p1 >= p2 ? 'A' : 'B',
  };
}

function ABTestCard({ test }: { test: ABTest }) {
  const [impressionsA, setImpressionsA] = useState('');
  const [conversionsA, setConversionsA] = useState('');
  const [impressionsB, setImpressionsB] = useState('');
  const [conversionsB, setConversionsB] = useState('');

  const hasData = impressionsA && conversionsA && impressionsB && conversionsB;
  const sig = hasData
    ? calcSignificance(Number(impressionsA), Number(conversionsA), Number(impressionsB), Number(conversionsB))
    : null;

  const statusVariant = test.status === 'running' ? 'secondary' : test.status === 'completed' ? 'success' : 'outline';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-gray-50/50 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{test.name}</h3>
              <Badge variant={statusVariant}>{test.status === 'running' ? 'Em andamento' : test.status === 'completed' ? 'Concluído' : test.status}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{test.hypothesis}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-muted-foreground">Orçamento</p>
            <p className="font-semibold">{formatCurrency(test.budget)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />Variável: <strong>{test.variable}</strong></span>
          <span>Métrica: <strong>{test.metric}</strong></span>
          <span>Duração: <strong>{test.duration} dias</strong></span>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Variantes */}
        <div className="grid gap-3 sm:grid-cols-2">
          {(['A', 'B'] as const).map((v) => {
            const text = v === 'A' ? test.variantA : test.variantB;
            const isWinner = sig?.winner === v && sig.significant;
            return (
              <div key={v} className={cn('rounded-lg border p-3 space-y-2', isWinner && 'border-green-400 bg-green-50')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', v === 'A' ? 'bg-[#1877F2] text-white' : 'bg-orange-500 text-white')}>
                      {v}
                    </span>
                    <span className="text-sm font-medium">Variante {v}</span>
                  </div>
                  {isWinner && <Trophy className="h-4 w-4 text-green-600" />}
                </div>
                <p className="text-sm text-gray-700">{text}</p>
              </div>
            );
          })}
        </div>

        {/* Calculadora de significância */}
        <div className="rounded-lg bg-gray-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculadora de significância</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#1877F2]">Variante A</p>
              <Input type="number" placeholder="Impressões" value={impressionsA} onChange={(e) => setImpressionsA(e.target.value)} className="h-8 text-xs" />
              <Input type="number" placeholder="Conversões" value={conversionsA} onChange={(e) => setConversionsA(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-orange-600">Variante B</p>
              <Input type="number" placeholder="Impressões" value={impressionsB} onChange={(e) => setImpressionsB(e.target.value)} className="h-8 text-xs" />
              <Input type="number" placeholder="Conversões" value={conversionsB} onChange={(e) => setConversionsB(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          {sig && (
            <div className={cn('rounded-md p-3 text-sm font-medium', sig.significant ? 'bg-green-100 text-green-800' : 'bg-yellow-50 text-yellow-800')}>
              {sig.significant
                ? `✅ Resultado significativo — Variante ${sig.winner} vence com ${sig.confidence}% de confiança`
                : sig.confidence > 0
                  ? `⏳ ${sig.confidence}% de confiança — precisa de mais dados`
                  : '⏳ Dados insuficientes — colete mais de 100 impressões por variante'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface FormData {
  name: string;
  hypothesis: string;
  variable: string;
  variantA: string;
  variantB: string;
  budget: string;
  duration: string;
  metric: string;
}

const EMPTY: FormData = {
  name: '',
  hypothesis: '',
  variable: 'Headline',
  variantA: '',
  variantB: '',
  budget: '',
  duration: '14',
  metric: 'CTR',
};

export default function ABTestsPage() {
  const qc = useQueryClient();
  const { data: tests = [], isLoading } = useQuery<ABTest[]>({
    queryKey: ['ab-tests'],
    queryFn: () => api.get('/ab-tests'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY);

  const createMutation = useMutation({
    mutationFn: (data: Omit<FormData, 'budget' | 'duration'> & { budget: number; duration: number }) =>
      api.post('/ab-tests', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ab-tests'] });
      setShowForm(false);
      setForm(EMPTY);
    },
  });

  function save() {
    if (!form.name || !form.variantA || !form.variantB || !form.budget) return;
    createMutation.mutate({
      ...form,
      budget: Number(form.budget),
      duration: Number(form.duration),
    });
  }

  function set(field: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Testes A/B</h1>
          <p className="text-muted-foreground">Compare variações e tome decisões baseadas em dados</p>
        </div>
        <Button variant="meta" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Fechar' : 'Novo teste'}
        </Button>
      </div>

      {/* Formulário */}
      {showForm && (
        <Card className="border-[#1877F2]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Criar teste A/B</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome do teste *</label>
              <Input placeholder="Ex: Headline emocional vs racional" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Hipótese</label>
              <Textarea placeholder="Ex: Headlines que apelam para emoção terão CTR maior para o público feminino 30-45 anos" value={form.hypothesis} onChange={(e) => set('hypothesis', e.target.value)} rows={2} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Variável testada</label>
                <Select value={form.variable} onValueChange={(v) => set('variable', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VARIABLES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Métrica principal</label>
                <Select value={form.metric} onValueChange={(v) => set('metric', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METRICS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Duração (dias)</label>
                <Input type="number" min={3} max={90} value={form.duration} onChange={(e) => set('duration', e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#1877F2]">Variante A *</label>
                <Textarea placeholder={`Versão A da ${form.variable.toLowerCase()}...`} value={form.variantA} onChange={(e) => set('variantA', e.target.value)} rows={3} className="border-[#1877F2]/30 focus-visible:ring-[#1877F2]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-orange-600">Variante B *</label>
                <Textarea placeholder={`Versão B da ${form.variable.toLowerCase()}...`} value={form.variantB} onChange={(e) => set('variantB', e.target.value)} rows={3} className="border-orange-300 focus-visible:ring-orange-400" />
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <label className="text-sm font-medium">Orçamento total (R$) *</label>
              <Input type="number" placeholder="500" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY); }}>Cancelar</Button>
              <Button variant="meta" onClick={save} disabled={!form.name || !form.variantA || !form.variantB || !form.budget || createMutation.isPending}>
                {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Criando...</> : 'Criar teste'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de testes */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-56 rounded-xl border bg-gray-100 animate-pulse" />)}
        </div>
      ) : tests.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-500">Nenhum teste criado</p>
          <p className="mt-1 text-sm text-muted-foreground">Teste headlines, imagens, copies e segmentações para melhorar resultados</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((t) => <ABTestCard key={t.id} test={t} />)}
        </div>
      )}
    </div>
  );
}
