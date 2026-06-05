import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles, Loader2, Heart, Trash2, Copy, Star, Megaphone, Eye } from 'lucide-react';
import { CopyScoreWidget } from '@/components/CopyScoreWidget';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AdPreviewModal } from '@/components/preview/AdPreviewModal';
import type { AdPreviewData } from '@/utils/preview-checklist';
import { AudiencePicker, audienceToText } from '@/components/AudiencePicker';

interface CopyRecord {
  id: string;
  format: string;
  framework: string;
  headline: string;
  body: string;
  cta: string;
  score?: number;
  favorite: boolean;
  createdAt: string;
}

const FRAMEWORKS = [
  { value: 'AIDA', label: 'AIDA', desc: 'Atenção → Interesse → Desejo → Ação' },
  { value: 'PAS', label: 'PAS', desc: 'Problema → Agitação → Solução' },
  { value: 'BAB', label: 'BAB', desc: 'Before → After → Bridge' },
];

const FORMATS = ['Feed', 'Stories', 'Reels', 'Carrossel', 'Vídeo'];

const TONES = ['Persuasivo', 'Urgente', 'Empático', 'Profissional', 'Descontraído', 'Provocativo'];

function CopyCard({ copy, onFavorite, onDelete, onCreateCampaign, onPreview }: {
  copy: CopyRecord;
  onFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateCampaign: (copy: CopyRecord) => void;
  onPreview: (copy: CopyRecord) => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(`${copy.headline}\n\n${copy.body}\n\n${copy.cta}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={cn('rounded-xl border bg-white p-5 space-y-3 transition-shadow hover:shadow-md', copy.favorite && 'border-yellow-300 bg-yellow-50/30')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{copy.framework}</Badge>
          <Badge variant="secondary">{copy.format}</Badge>
          {copy.score != null && (
            <div className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {copy.score}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onPreview(copy)} className="rounded p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Visualizar no anúncio">
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button onClick={copyToClipboard} className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100" title="Copiar">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onFavorite(copy.id)} className={cn('rounded p-1.5 hover:bg-gray-100', copy.favorite ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500')} title="Favoritar">
            <Heart className={cn('h-3.5 w-3.5', copy.favorite && 'fill-yellow-400')} />
          </button>
          <button onClick={() => onDelete(copy.id)} className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50" title="Deletar">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <p className="font-semibold text-gray-900 leading-snug">{copy.headline}</p>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{copy.body}</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center rounded-full border border-[#1877F2]/30 bg-[#e7f0fd] px-3 py-0.5 text-xs font-medium text-[#1877F2]">
          {copy.cta}
        </span>
        {copied && <span className="text-xs text-green-600 font-medium">✅ Copiado!</span>}
      </div>

      {/* Score de copy com IA */}
      <div className="pt-1 border-t">
        <CopyScoreWidget headline={copy.headline} body={copy.body} cta={copy.cta} compact />
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full border-[#1877F2]/40 text-[#1877F2] hover:bg-[#e7f0fd] hover:border-[#1877F2]"
        onClick={() => onCreateCampaign(copy)}
      >
        <Megaphone className="h-3.5 w-3.5 mr-1.5" />
        Criar campanha com este copy
      </Button>
    </div>
  );
}

export default function CopiesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: copies = [], isLoading } = useQuery<CopyRecord[]>({
    queryKey: ['copies'],
    queryFn: () => api.get('/copies'),
  });
  const [previewAd, setPreviewAd] = useState<AdPreviewData | null>(null);

  // Form state
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);
  const [framework, setFramework] = useState('AIDA');
  const [format, setFormat] = useState('Feed');
  const [tone, setTone] = useState('Persuasivo');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [filterFav, setFilterFav] = useState(false);

  const favoriteMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/copies/${id}/favorite`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copies'] }),
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/copies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['copies'] });
      toast.success('Copy removida.');
    },
    onError: (e: Error) => toast.error(`Erro ao remover: ${e.message}`),
  });

  async function generate() {
    if (!product) return;
    setGenerating(true);
    setError('');
    try {
      await api.post('/copies/generate', { product, audience, framework, format, tone });
      qc.invalidateQueries({ queryKey: ['copies'] });
      toast.success('Copies geradas com sucesso!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar copy';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  const displayed = filterFav ? copies.filter((c) => c.favorite) : copies;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gerador de Copies</h1>
          <p className="text-muted-foreground">Crie textos persuasivos com IA para Meta Ads</p>
        </div>
        <Badge variant="secondary">{copies.length} copies</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Painel de geração */}
        <div className="space-y-4">
          <Card className="sticky top-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Gerar novo copy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Produto / Serviço *</label>
                <Input placeholder="Ex: Curso de inglês online" value={product} onChange={(e) => setProduct(e.target.value)} />
              </div>

              {/* Público-alvo — picker de salvos + campo livre */}
              <div className="space-y-2">
                <AudiencePicker
                  label="Público-alvo salvo"
                  value={selectedAudienceId}
                  onChange={(aud) => {
                    setSelectedAudienceId(aud?.id ?? null);
                    if (aud) setAudience(audienceToText(aud));
                    else setAudience('');
                  }}
                  placeholder="🎯 Selecionar público da biblioteca..."
                />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {selectedAudienceId ? 'Descrição (editável)' : 'Ou descreva manualmente'}
                  </label>
                  <Input
                    placeholder="Ex: Profissionais 25-40 anos, interessados em saúde"
                    value={audience}
                    onChange={(e) => {
                      setAudience(e.target.value);
                      if (selectedAudienceId) setSelectedAudienceId(null); // desvincula ao editar
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Framework</label>
                  <Select value={framework} onValueChange={setFramework}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FRAMEWORKS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <div>
                            <div className="font-medium">{f.label}</div>
                            <div className="text-xs text-muted-foreground">{f.desc}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Formato</label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tom de voz</label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        tone === t ? 'border-[#1877F2] bg-[#e7f0fd] text-[#1877F2]' : 'border-gray-200 text-gray-600 hover:border-gray-300',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button variant="meta" className="w-full" onClick={generate} disabled={!product || generating}>
                {generating
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
                  : <><Sparkles className="h-4 w-4" /> Gerar copy {framework}</>
                }
              </Button>

              {/* Guia rápido dos frameworks */}
              <div className="rounded-lg bg-gray-50 p-3 space-y-1.5">
                {FRAMEWORKS.map((f) => (
                  <div key={f.value} className="text-xs">
                    <span className="font-semibold text-gray-700">{f.label}:</span>{' '}
                    <span className="text-muted-foreground">{f.desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lista de copies */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{displayed.length} resultado(s)</p>
            <button
              onClick={() => setFilterFav(!filterFav)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filterFav ? 'border-yellow-400 bg-yellow-50 text-yellow-700' : 'border-gray-200 text-gray-600 hover:border-yellow-300',
              )}
            >
              <Heart className={cn('h-3 w-3', filterFav && 'fill-yellow-400 text-yellow-400')} />
              Favoritos
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-36 rounded-xl border bg-gray-100 animate-pulse" />)}
            </div>
          ) : displayed.length === 0 ? (
            <div className="rounded-xl border border-dashed py-16 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 font-medium text-gray-500">{filterFav ? 'Nenhum favorito ainda' : 'Nenhum copy gerado ainda'}</p>
              <p className="mt-1 text-sm text-muted-foreground">Preencha o formulário ao lado e clique em gerar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayed.map((c) => (
                <CopyCard
                  key={c.id}
                  copy={c}
                  onFavorite={(id) => favoriteMutation.mutate(id)}
                  onDelete={(id) => { if (confirm('Deletar este copy?')) deleteMutation.mutate(id); }}
                  onCreateCampaign={(copy) => {
                    // Salva dados do copy no sessionStorage para o wizard ler
                    sessionStorage.setItem('campaignFromCopy', JSON.stringify({
                      fromCopy: { headline: copy.headline, body: copy.body, cta: copy.cta, format: copy.format },
                      product,
                      audience,
                    }));
                    navigate('/campaigns/new');
                  }}
                  onPreview={(copy) => setPreviewAd({
                    headline: copy.headline,
                    bodyText: copy.body,
                    cta: copy.cta,
                    destinationUrl: '',
                    pageName: 'Sua Empresa',
                  })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
