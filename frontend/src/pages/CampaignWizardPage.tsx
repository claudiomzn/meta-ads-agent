import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useCreateCampaign } from '@/hooks/useCampaigns';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const OBJECTIVES = [
  { value: 'LEAD_GENERATION', label: 'Geração de leads' },
  { value: 'CONVERSIONS', label: 'Conversões' },
  { value: 'TRAFFIC', label: 'Tráfego' },
  { value: 'AWARENESS', label: 'Reconhecimento de marca' },
  { value: 'ENGAGEMENT', label: 'Engajamento' },
  { value: 'VIDEO_VIEWS', label: 'Visualizações de vídeo' },
];

interface AdPlan {
  name: string;
  headline: string;
  bodyText: string;
  ctaType: string;
  destinationUrl: string;
}

interface AdSetPlan {
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  ads: AdPlan[];
  rationale?: string;
  _open: boolean;
}

interface AIPlan {
  name: string;
  strategy: string;
  adSets: AdSetPlan[];
}

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();

  // Formulário base
  const [product, setProduct] = useState('');
  const [objective, setObjective] = useState('LEAD_GENERATION');
  const [budget, setBudget] = useState('');
  const [audience, setAudience] = useState('');
  const [differentials, setDifferentials] = useState('');

  // Estado do plano IA
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [genError, setGenError] = useState('');
  const [saving, setSaving] = useState(false);

  async function generatePlan() {
    if (!product || !objective || !budget) return;
    setGenerating(true);
    setGenError('');
    try {
      const result = await api.post<AIPlan>('/campaigns/generate-plan', {
        product,
        objective,
        budget: Number(budget),
        audience,
        differentials,
      });
      // Adiciona _open para controle de accordion
      setPlan({
        ...result,
        adSets: result.adSets.map((as) => ({ ...as, _open: true })),
      });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao gerar plano');
    } finally {
      setGenerating(false);
    }
  }

  async function saveCampaign() {
    if (!plan) return;
    setSaving(true);
    try {
      const campaign = await createCampaign.mutateAsync({
        name: plan.name,
        product,
        objective,
        budget: Number(budget),
        adSets: plan.adSets.map((as) => ({
          name: as.name,
          dailyBudget: as.dailyBudget,
          targeting: as.targeting ?? {},
          optimizationGoal: as.optimizationGoal ?? 'LEAD_GENERATION',
          billingEvent: as.billingEvent ?? 'IMPRESSIONS',
          ads: as.ads.map((ad) => ({
            name: ad.name,
            headline: ad.headline,
            bodyText: ad.bodyText,
            cta: ad.ctaType,
            imageUrl: ad.imageUrl,
          })),
        })),
      });
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  function updateAdSet(i: number, field: keyof AdSetPlan, value: unknown) {
    if (!plan) return;
    const adSets = [...plan.adSets];
    (adSets[i] as Record<string, unknown>)[field] = value;
    setPlan({ ...plan, adSets });
  }

  function updateAd(setIdx: number, adIdx: number, field: keyof AdPlan, value: string) {
    if (!plan) return;
    const adSets = [...plan.adSets];
    adSets[setIdx].ads[adIdx] = { ...adSets[setIdx].ads[adIdx], [field]: value };
    setPlan({ ...plan, adSets });
  }

  function addAd(setIdx: number) {
    if (!plan) return;
    const adSets = [...plan.adSets];
    adSets[setIdx].ads.push({ name: 'Novo anúncio', headline: '', bodyText: '', ctaType: 'LEARN_MORE', destinationUrl: '' });
    setPlan({ ...plan, adSets });
  }

  function removeAd(setIdx: number, adIdx: number) {
    if (!plan) return;
    const adSets = [...plan.adSets];
    adSets[setIdx].ads = adSets[setIdx].ads.filter((_, i) => i !== adIdx);
    setPlan({ ...plan, adSets });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova campanha</h1>
        <p className="text-muted-foreground">Preencha os dados e gere um plano completo com IA</p>
      </div>

      {/* Formulário base */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da campanha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Produto / Serviço *</label>
              <Input placeholder="Ex: Curso de Excel, Clínica Odontológica..." value={product} onChange={(e) => setProduct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Objetivo *</label>
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJECTIVES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Orçamento total (R$) *</label>
              <Input type="number" placeholder="3000" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Público-alvo</label>
              <Input placeholder="Ex: Mulheres 30-50 anos, interessadas em saúde" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Diferenciais do produto</label>
            <Textarea placeholder="O que torna seu produto único? Preço, resultado, garantia..." value={differentials} onChange={(e) => setDifferentials(e.target.value)} rows={2} />
          </div>

          {genError && <p className="text-sm text-destructive">{genError}</p>}

          <Button
            variant="meta"
            onClick={generatePlan}
            disabled={!product || !objective || !budget || generating}
            className="w-full"
          >
            {generating
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando plano com IA...</>
              : <><Sparkles className="h-4 w-4" /> Gerar plano completo com IA</>
            }
          </Button>
        </CardContent>
      </Card>

      {/* Plano gerado */}
      {plan && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-sm text-muted-foreground">{plan.strategy}</p>
            </div>
            <Button variant="outline" size="sm" onClick={generatePlan} disabled={generating}>
              <Sparkles className="h-3.5 w-3.5" />
              Regenerar
            </Button>
          </div>

          {/* AdSets */}
          {plan.adSets.map((as, si) => (
            <Card key={si} className="overflow-hidden">
              <button
                className="flex w-full items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
                onClick={() => updateAdSet(si, '_open', !as._open)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">📦 {as.name}</span>
                    <span className="text-sm text-muted-foreground">R$ {as.dailyBudget}/dia</span>
                  </div>
                  {as.rationale && <p className="mt-0.5 text-xs text-muted-foreground">{as.rationale}</p>}
                </div>
                {as._open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {as._open && (
                <div className="border-t px-5 pb-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Nome do conjunto</label>
                      <Input value={as.name} onChange={(e) => updateAdSet(si, 'name', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Orçamento diário (R$)</label>
                      <Input type="number" value={as.dailyBudget} onChange={(e) => updateAdSet(si, 'dailyBudget', Number(e.target.value))} />
                    </div>
                  </div>

                  {/* Anúncios */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Anúncios ({as.ads.length})</p>
                    {as.ads.map((ad, ai) => (
                      <div key={ai} className="rounded-lg border bg-gray-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">🖼 {ad.name}</span>
                          <button onClick={() => removeAd(si, ai)} className="text-gray-400 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Input placeholder="Headline" value={ad.headline} onChange={(e) => updateAd(si, ai, 'headline', e.target.value)} />
                        <Textarea placeholder="Texto do anúncio" value={ad.bodyText} onChange={(e) => updateAd(si, ai, 'bodyText', e.target.value)} rows={2} />
                        <div className="grid gap-2 grid-cols-2">
                          <Input placeholder="URL de destino" value={ad.destinationUrl} onChange={(e) => updateAd(si, ai, 'destinationUrl', e.target.value)} />
                          <Input placeholder="CTA (LEARN_MORE...)" value={ad.ctaType} onChange={(e) => updateAd(si, ai, 'ctaType', e.target.value)} />
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => addAd(si)}>
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar anúncio
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {/* Salvar */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => navigate('/campaigns')}>Cancelar</Button>
            <Button variant="meta" onClick={saveCampaign} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : 'Salvar campanha'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
