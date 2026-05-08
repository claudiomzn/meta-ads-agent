import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Trash2, Sparkles, Loader2, X } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AudienceRecord {
  id: string;
  name: string;
  interests: string;
  behaviors?: string;
  ageMin: number;
  ageMax: number;
  gender: string;
  locations: string;
  estimatedSize?: number;
  metaAudienceId?: string;
  createdAt: string;
}

const GENDER_LABELS: Record<string, string> = { all: 'Todos', male: 'Masculino', female: 'Feminino' };

function AudienceCard({ audience, onDelete }: { audience: AudienceRecord; onDelete: (id: string) => void }) {
  const interests = audience.interests.split(',').map((i) => i.trim()).filter(Boolean);
  const behaviors = audience.behaviors?.split(',').map((b) => b.trim()).filter(Boolean) ?? [];
  const locations = audience.locations.split(',').map((l) => l.trim()).filter(Boolean);

  return (
    <Card className="group">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold truncate">{audience.name}</p>
              {audience.metaAudienceId && (
                <Badge variant="success" className="text-xs">no Meta</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {GENDER_LABELS[audience.gender]} · {audience.ageMin}–{audience.ageMax} anos · {locations.join(', ')}
              {audience.estimatedSize && <span> · ~{(audience.estimatedSize / 1000).toFixed(0)}k pessoas</span>}
            </p>
          </div>
          <button
            onClick={() => { if (confirm(`Deletar "${audience.name}"?`)) onDelete(audience.id); }}
            className="opacity-0 group-hover:opacity-100 rounded p-1 text-gray-400 hover:text-red-500 transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {interests.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Interesses</p>
            <div className="flex flex-wrap gap-1.5">
              {interests.map((int, i) => (
                <span key={i} className="rounded-full bg-[#e7f0fd] px-2.5 py-0.5 text-xs text-[#1877F2]">{int}</span>
              ))}
            </div>
          </div>
        )}

        {behaviors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Comportamentos</p>
            <div className="flex flex-wrap gap-1.5">
              {behaviors.map((b, i) => (
                <span key={i} className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs text-purple-700">{b}</span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface FormData {
  name: string;
  interests: string;
  behaviors: string;
  ageMin: number;
  ageMax: number;
  gender: string;
  locations: string;
  estimatedSize: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  interests: '',
  behaviors: '',
  ageMin: 25,
  ageMax: 55,
  gender: 'all',
  locations: 'Brasil',
  estimatedSize: '',
};

const INTEREST_SUGGESTIONS = [
  'Marketing digital', 'Empreendedorismo', 'Fitness', 'Saúde e bem-estar', 'Moda',
  'Tecnologia', 'Gastronomia', 'Viagens', 'Finanças pessoais', 'Educação',
];

export default function AudiencesPage() {
  const qc = useQueryClient();
  const { data: audiences = [], isLoading } = useQuery<AudienceRecord[]>({
    queryKey: ['audiences'],
    queryFn: () => api.get('/audiences'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestProduct, setSuggestProduct] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: Omit<FormData, 'estimatedSize'> & { estimatedSize?: number }) =>
      api.post('/audiences', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audiences'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/audiences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audiences'] }),
  });

  async function suggestInterests() {
    if (!suggestProduct) return;
    setSuggestLoading(true);
    try {
      // Usa a IA para sugerir interesses baseados no produto
      const result = await api.post<{ interests: string; behaviors: string }>('/audiences/suggest', { product: suggestProduct });
      setForm((f) => ({ ...f, interests: result.interests, behaviors: result.behaviors }));
    } catch {
      // Fallback com sugestões fixas
      const relevant = INTEREST_SUGGESTIONS.slice(0, 4).join(', ');
      setForm((f) => ({ ...f, interests: relevant }));
    } finally {
      setSuggestLoading(false);
    }
  }

  function save() {
    if (!form.name || !form.interests) return;
    createMutation.mutate({
      ...form,
      estimatedSize: form.estimatedSize ? Number(form.estimatedSize) : undefined,
    });
  }

  function addInterest(interest: string) {
    const current = form.interests.split(',').map((i) => i.trim()).filter(Boolean);
    if (!current.includes(interest)) {
      setForm((f) => ({ ...f, interests: [...current, interest].join(', ') }));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Biblioteca de Públicos</h1>
          <p className="text-muted-foreground">Salve e reutilize segmentações em suas campanhas</p>
        </div>
        <Button variant="meta" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Fechar' : 'Novo público'}
        </Button>
      </div>

      {/* Formulário de criação */}
      {showForm && (
        <Card className="border-[#1877F2]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Definir público</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sugestão por IA */}
            <div className="flex gap-2">
              <Input
                placeholder="Digite o produto para sugerir interesses com IA..."
                value={suggestProduct}
                onChange={(e) => setSuggestProduct(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={suggestInterests} disabled={!suggestProduct || suggestLoading}>
                {suggestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Sugerir
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome do público *</label>
                <Input placeholder="Ex: Público Frio — Mulheres 30-45" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Localização</label>
                <Input placeholder="Brasil" value={form.locations} onChange={(e) => setForm((f) => ({ ...f, locations: e.target.value }))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Idade mín.</label>
                <Input type="number" min={18} max={65} value={form.ageMin} onChange={(e) => setForm((f) => ({ ...f, ageMin: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Idade máx.</label>
                <Input type="number" min={18} max={65} value={form.ageMax} onChange={(e) => setForm((f) => ({ ...f, ageMax: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Gênero</label>
                <div className="flex rounded-md border overflow-hidden">
                  {['all', 'female', 'male'].map((g) => (
                    <button
                      key={g}
                      onClick={() => setForm((f) => ({ ...f, gender: g }))}
                      className={cn(
                        'flex-1 py-2 text-xs font-medium transition-colors',
                        form.gender === g ? 'bg-[#1877F2] text-white' : 'hover:bg-gray-50 text-gray-600',
                      )}
                    >
                      {g === 'all' ? 'Todos' : g === 'female' ? 'Fem.' : 'Masc.'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Interesses *</label>
              <Input placeholder="Marketing digital, Empreendedorismo, Saúde..." value={form.interests} onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))} />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {INTEREST_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => addInterest(s)}
                    className="rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs text-gray-500 hover:border-[#1877F2] hover:text-[#1877F2] transition-colors"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Comportamentos</label>
                <Input placeholder="Compradores online, Viajantes frequentes..." value={form.behaviors} onChange={(e) => setForm((f) => ({ ...f, behaviors: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tamanho estimado</label>
                <Input type="number" placeholder="500000" value={form.estimatedSize} onChange={(e) => setForm((f) => ({ ...f, estimatedSize: e.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Cancelar</Button>
              <Button variant="meta" onClick={save} disabled={!form.name || !form.interests || createMutation.isPending}>
                {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : 'Salvar público'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grid de públicos */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl border bg-gray-100 animate-pulse" />)}
        </div>
      ) : audiences.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Users className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-500">Nenhum público salvo</p>
          <p className="mt-1 text-sm text-muted-foreground">Crie públicos reutilizáveis para suas campanhas</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {audiences.map((a) => (
            <AudienceCard key={a.id} audience={a} onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
