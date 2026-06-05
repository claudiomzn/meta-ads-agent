import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Loader2, Plus, Trash2, ChevronDown, ChevronUp, Save, ArrowLeft } from 'lucide-react';
import { useCampaign, useUpdateCampaign } from '@/hooks/useCampaigns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MediaUpload } from '@/components/MediaUpload';

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
  imageUrl?: string;
  videoUrl?: string;
}

interface AdSetPlan {
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  ads: AdPlan[];
  _open: boolean;
}

export default function CampaignEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: campaign, isLoading } = useCampaign(id!);
  const updateCampaign = useUpdateCampaign(id!);

  const [name, setName] = useState('');
  const [product, setProduct] = useState('');
  const [objective, setObjective] = useState('LEAD_GENERATION');
  const [budget, setBudget] = useState('');
  const [adSets, setAdSets] = useState<AdSetPlan[]>([]);
  const [saveError, setSaveError] = useState('');

  // Preenche form quando campanha carrega
  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name);
    setProduct(campaign.product);
    setObjective(campaign.objective);
    setBudget(String(campaign.budget));
    setAdSets(
      campaign.adSets.map((as) => ({
        name: as.name,
        dailyBudget: as.dailyBudget,
        targeting: typeof as.targeting === 'string' ? JSON.parse(as.targeting || '{}') : (as.targeting as Record<string, unknown>) ?? {},
        optimizationGoal: as.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        _open: true,
        ads: as.ads.map((ad) => ({
          name: ad.name,
          headline: ad.headline,
          bodyText: ad.bodyText,
          ctaType: ad.cta,
          destinationUrl: ad.destinationUrl ?? '',
          imageUrl: ad.imageUrl,
          videoUrl: ad.videoUrl,
        })),
      }))
    );
  }, [campaign]);

  function updateAdSet(i: number, field: keyof AdSetPlan, value: unknown) {
    const next = [...adSets];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next[i] as any)[field] = value;
    setAdSets(next);
  }

  function updateAd(si: number, ai: number, field: keyof AdPlan, value: string) {
    const next = [...adSets];
    next[si].ads[ai] = { ...next[si].ads[ai], [field]: value };
    setAdSets(next);
  }

  function addAd(si: number) {
    const next = [...adSets];
    next[si].ads.push({ name: 'Novo anúncio', headline: '', bodyText: '', ctaType: 'LEARN_MORE', destinationUrl: '' });
    setAdSets(next);
  }

  function removeAd(si: number, ai: number) {
    const next = [...adSets];
    next[si].ads = next[si].ads.filter((_, i) => i !== ai);
    setAdSets(next);
  }

  function addAdSet() {
    setAdSets([...adSets, {
      name: 'Novo conjunto',
      dailyBudget: Number(budget) / 2 || 50,
      targeting: {},
      optimizationGoal: 'LEAD_GENERATION',
      billingEvent: 'IMPRESSIONS',
      _open: true,
      ads: [],
    }]);
  }

  function removeAdSet(i: number) {
    setAdSets(adSets.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaveError('');
    try {
      await updateCampaign.mutateAsync({
        name,
        product,
        objective,
        budget: Number(budget),
        adSets: adSets.map((as) => ({
          name: as.name,
          dailyBudget: as.dailyBudget,
          targeting: as.targeting,
          optimizationGoal: as.optimizationGoal,
          billingEvent: as.billingEvent,
          ads: as.ads.map((ad) => ({
            name: ad.name,
            headline: ad.headline,
            bodyText: ad.bodyText,
            cta: ad.ctaType,
            destinationUrl: ad.destinationUrl,
            imageUrl: ad.imageUrl,
            videoUrl: ad.videoUrl,
          })),
        })) as never,
      });
      navigate(`/campaigns/${id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground p-8">Carregando campanha...</div>;
  if (!campaign) return <div className="text-destructive p-8">Campanha não encontrada.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/campaigns" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Campanhas
        </Link>
        <span>/</span>
        <Link to={`/campaigns/${id}`} className="hover:text-foreground truncate max-w-[200px]">{campaign.name}</Link>
        <span>/</span>
        <span className="text-foreground font-medium">Editar</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Editar campanha</h1>
        <p className="text-muted-foreground">Altere os dados e clique em salvar</p>
      </div>

      {/* Dados gerais */}
      <Card>
        <CardHeader><CardTitle className="text-base">Dados gerais</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome da campanha</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Objetivo</label>
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
              <label className="text-sm font-medium">Produto / Serviço</label>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Orçamento total (R$)</label>
              <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ad Sets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Conjuntos de anúncios ({adSets.length})</h2>
          <Button variant="outline" size="sm" onClick={addAdSet}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar conjunto
          </Button>
        </div>

        {adSets.map((as, si) => (
          <Card key={si} className="overflow-hidden">
            <button
              className="flex w-full items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
              onClick={() => updateAdSet(si, '_open', !as._open)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium truncate">📦 {as.name}</span>
                <span className="text-sm text-muted-foreground shrink-0">R$ {as.dailyBudget}/dia</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm('Remover conjunto?')) removeAdSet(si); }}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {as._open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
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
                      <MediaUpload
                        value={ad.imageUrl ?? ad.videoUrl}
                        onChange={(url, meta) => {
                          updateAd(si, ai, meta?.type === 'video' ? 'videoUrl' : 'imageUrl', url);
                          if (meta?.type === 'video') updateAd(si, ai, 'imageUrl', '');
                          else updateAd(si, ai, 'videoUrl', '');
                        }}
                      />
                      <Input placeholder="Nome do anúncio" value={ad.name} onChange={(e) => updateAd(si, ai, 'name', e.target.value)} />
                      <Input placeholder="Headline" value={ad.headline} onChange={(e) => updateAd(si, ai, 'headline', e.target.value)} />
                      <Textarea placeholder="Texto do anúncio" value={ad.bodyText} onChange={(e) => updateAd(si, ai, 'bodyText', e.target.value)} rows={2} />
                      <div className="grid gap-2 grid-cols-2">
                        <div className="space-y-1">
                          <Input
                            placeholder="URL de destino"
                            value={ad.destinationUrl}
                            onChange={(e) => updateAd(si, ai, 'destinationUrl', e.target.value)}
                            className={ad.ctaType === 'WHATSAPP_MESSAGE' ? 'border-green-400 bg-green-50 text-xs' : ''}
                          />
                          {ad.ctaType === 'WHATSAPP_MESSAGE' && <p className="text-xs text-green-600 font-medium">✅ WhatsApp</p>}
                        </div>
                        <Input placeholder="CTA" value={ad.ctaType} onChange={(e) => updateAd(si, ai, 'ctaType', e.target.value)} />
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addAd(si)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar anúncio
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {/* Ações */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="outline" onClick={() => navigate(`/campaigns/${id}`)}>Cancelar</Button>
        <Button variant="meta" onClick={save} disabled={updateCampaign.isPending}>
          {updateCampaign.isPending
            ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Salvando...</>
            : <><Save className="h-4 w-4 mr-1" /> Salvar alterações</>}
        </Button>
      </div>
    </div>
  );
}
