import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, Plus, Trash2, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useCreateCampaign } from '@/hooks/useCampaigns';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MediaUpload } from '@/components/MediaUpload';
import { AdPreviewModal } from '@/components/preview/AdPreviewModal';
import type { AdPreviewData } from '@/utils/preview-checklist';
import { AudiencePicker } from '@/components/AudiencePicker';

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
  audienceId?: string;
  ads: AdPlan[];
  rationale?: string;
  _open: boolean;
}

interface AIPlan {
  name: string;
  strategy: string;
  adSets: AdSetPlan[];
  // Campos extras presentes quando criado via template ou onboarding
  product?: string;
  objective?: string;
  budget?: number;
}

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();

  // Lê dados do copy importado do sessionStorage — uma vez, no mount
  const [fromCopy] = useState<{
    fromCopy: { headline: string; body: string; cta: string; format: string };
    product: string;
    audience: string;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem('campaignFromCopy');
      if (raw) { sessionStorage.removeItem('campaignFromCopy'); return JSON.parse(raw); }
    } catch {}
    return null;
  });

  // Lê template selecionado — pré-preenche formulário E gera plano direto
  const [templatePlan] = useState<AIPlan | null>(() => {
    try {
      const raw = sessionStorage.getItem('templateData');
      if (raw) { sessionStorage.removeItem('templateData'); return JSON.parse(raw); }
    } catch {}
    return null;
  });

  // Lê contexto do onboarding wizard
  const [onboardingCtx] = useState<{
    niche: string; nicheLabel: string;
    businessName?: string;
    objective: string; objLabel: string;
    budget: string; experience?: string;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem('onboardingContext');
      if (raw) { sessionStorage.removeItem('onboardingContext'); return JSON.parse(raw); }
    } catch {}
    return null;
  });

  // Mapeia objetivo do onboarding para valor da API
  function mapOnboardingObjective(obj: string): string {
    const map: Record<string, string> = {
      leads: 'LEAD_GENERATION',
      vendas: 'CONVERSIONS',
      whatsapp: 'LEAD_GENERATION',
      alcance: 'AWARENESS',
    };
    return map[obj] ?? 'LEAD_GENERATION';
  }

  // Formulário base — pré-preenche com dados do copy / onboarding / template
  const [product, setProduct] = useState(
    templatePlan?.product ?? fromCopy?.product ?? onboardingCtx?.businessName ?? onboardingCtx?.nicheLabel ?? ''
  );
  const [objective, setObjective] = useState(
    templatePlan?.objective
      ?? (onboardingCtx ? mapOnboardingObjective(onboardingCtx.objective) : 'LEAD_GENERATION')
  );
  const [budget, setBudget] = useState(
    templatePlan?.budget ? String(templatePlan.budget) : (onboardingCtx?.budget ?? '')
  );
  const [audience, setAudience] = useState(fromCopy?.audience ?? '');
  const [differentials, setDifferentials] = useState('');

  const [whatsapp, setWhatsapp]           = useState('');
  const [ticketMedio, setTicketMedio]     = useState('');
  const [regiao, setRegiao]               = useState('');
  const [concorrentes, setConcorrentes]   = useState('');
  const [showExtraFields, setExtraFields] = useState(false);

  // Estado do plano IA — se veio de template, já começa com o plano pronto
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<AIPlan | null>(() => {
    if (!templatePlan) return null;
    return {
      name: templatePlan.name ?? 'Campanha',
      strategy: 'Template pré-configurado para o seu nicho. Personalize os textos conforme necessário.',
      adSets: templatePlan.adSets.map((as) => ({ ...as, _open: true })),
    };
  });
  const [genError, setGenError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewAd, setPreviewAd] = useState<AdPreviewData | null>(null);

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
        ticketMedio: ticketMedio ? Number(ticketMedio) : undefined,
        regiao: regiao || undefined,
        concorrentes: concorrentes || undefined,
        niche: onboardingCtx?.niche || undefined,
        businessName: onboardingCtx?.businessName || undefined,
      });
      // Monta link WhatsApp se número foi informado
      const waNumber = whatsapp.replace(/\D/g, '');
      const waUrl = waNumber
        ? `https://wa.me/55${waNumber}?text=${encodeURIComponent(`Olá! Vi seu anúncio sobre ${product} e gostaria de mais informações.`)}`
        : '';

      // Adiciona _open para controle de accordion e aplica destino WhatsApp
      const generatedPlan = {
        ...result,
        adSets: result.adSets.map((as, si) => ({
          ...as,
          _open: true,
          ads: as.ads.map((ad, ai) => {
            // Se veio de um copy, usa headline/body/cta do copy no primeiro anúncio do primeiro conjunto
            const isCopyAd = fromCopy?.fromCopy && si === 0 && ai === 0;
            return {
              ...ad,
              headline: isCopyAd ? fromCopy.fromCopy!.headline : ad.headline,
              bodyText: isCopyAd ? fromCopy.fromCopy!.body : ad.bodyText,
              ctaType: isCopyAd && waUrl ? 'WHATSAPP_MESSAGE' : isCopyAd ? fromCopy.fromCopy!.cta : waUrl ? 'WHATSAPP_MESSAGE' : ad.ctaType,
              destinationUrl: waUrl || ad.destinationUrl,
            };
          }),
        })),
      };
      setPlan(generatedPlan);
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
          audienceId: as.audienceId,
          ads: as.ads.map((ad) => ({
            name: ad.name,
            headline: ad.headline,
            bodyText: ad.bodyText,
            cta: ad.ctaType,
            destinationUrl: ad.destinationUrl,
            imageUrl: ad.imageUrl,
            videoUrl: ad.videoUrl,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adSets[i] as any)[field] = value;
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

      {fromCopy?.fromCopy && (
        <div className="rounded-lg border border-[#1877F2]/30 bg-[#e7f0fd] px-4 py-3 text-sm text-[#1877F2]">
          <strong>✅ Copy importado:</strong> "{fromCopy.fromCopy.headline.substring(0, 60)}..." — será usado no primeiro anúncio gerado.
        </div>
      )}

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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">WhatsApp para leads</label>
              <Input placeholder="Ex: 92999990000" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              <p className="text-xs text-muted-foreground">Sem +55 e sem espaços. O lead cai direto no seu WhatsApp.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Diferenciais do produto</label>
              <Textarea placeholder="O que torna seu produto único? Preço, resultado, garantia..." value={differentials} onChange={(e) => setDifferentials(e.target.value)} rows={2} />
            </div>
          </div>

          {/* Contexto adicional — melhora muito a qualidade da IA */}
          <div>
            <button
              type="button"
              onClick={() => setExtraFields((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-[#1877F2] hover:underline"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', showExtraFields && 'rotate-180')} />
              {showExtraFields ? 'Ocultar contexto adicional' : '+ Adicionar contexto (melhora a IA)'}
            </button>

            {showExtraFields && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 rounded-xl border border-dashed border-[#1877F2]/30 bg-[#1877F2]/3 p-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Ticket médio (R$)</label>
                  <Input
                    type="number"
                    placeholder="Ex: 150"
                    value={ticketMedio}
                    onChange={(e) => setTicketMedio(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Valor médio que um cliente paga. Ajuda a calibrar o orçamento.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Região / Cidade-alvo</label>
                  <Input
                    placeholder="Ex: São Paulo, SP"
                    value={regiao}
                    onChange={(e) => setRegiao(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Deixe em branco para alcance nacional.</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Principais concorrentes</label>
                  <Input
                    placeholder="Ex: Empresa X, Marca Y — o que eles fazem melhor/pior que você?"
                    value={concorrentes}
                    onChange={(e) => setConcorrentes(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">A IA vai usar isso para criar anúncios que se destacam no mercado.</p>
                </div>
              </div>
            )}
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

                  {/* Público-alvo salvo */}
                  <AudiencePicker
                    label="Público-alvo"
                    value={as.audienceId ?? null}
                    onChange={(aud) => {
                      updateAdSet(si, 'audienceId', aud?.id ?? undefined);
                      // Preenche o targeting com os dados do público salvo
                      if (aud) {
                        updateAdSet(si, 'targeting', {
                          ...((as.targeting as Record<string, unknown>) ?? {}),
                          age_min: aud.ageMin,
                          age_max: aud.ageMax,
                          genders: aud.gender === 'all' ? [] : [aud.gender === 'male' ? 1 : 2],
                          geo_locations: { cities: aud.locations.split(',').map((l) => ({ name: l.trim() })) },
                          interests: aud.interests.split(',').map((i) => ({ name: i.trim() })),
                        });
                      }
                    }}
                  />

                  {/* Anúncios */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Anúncios ({as.ads.length})</p>
                    {as.ads.map((ad, ai) => (
                      <div key={ai} className="rounded-lg border bg-gray-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">🖼 {ad.name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setPreviewAd({
                                headline: ad.headline,
                                bodyText: ad.bodyText,
                                cta: ad.ctaType,
                                destinationUrl: ad.destinationUrl ?? '',
                                imageUrl: ad.imageUrl,
                                videoUrl: ad.videoUrl,
                                pageName: product || 'Sua Empresa',
                              })}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                              title="Ver prévia visual"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Prévia
                            </button>
                            <button onClick={() => removeAd(si, ai)} className="text-gray-400 hover:text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <MediaUpload
                          value={ad.imageUrl ?? ad.videoUrl}
                          onChange={(url, meta) => {
                            updateAd(si, ai, meta?.type === 'video' ? 'videoUrl' : 'imageUrl', url);
                            if (meta?.type === 'video') updateAd(si, ai, 'imageUrl', '');
                            else updateAd(si, ai, 'videoUrl', '');
                          }}
                        />
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
                            {ad.ctaType === 'WHATSAPP_MESSAGE' && (
                              <p className="text-xs text-green-600 font-medium">✅ WhatsApp</p>
                            )}
                          </div>
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

      {/* Modal de prévia */}
      {previewAd && (
        <AdPreviewModal
          isOpen={true}
          onClose={() => setPreviewAd(null)}
          ad={previewAd}
        />
      )}
    </div>
  );
}
