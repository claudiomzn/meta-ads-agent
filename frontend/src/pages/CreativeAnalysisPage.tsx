import { useState, useRef, useCallback } from 'react';
import { Upload, Image as ImageIcon, Loader2, ToggleLeft, ToggleRight, X, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CreativeScoreCard, type AnalysisResult } from '@/components/CreativeScoreCard';
import { getToken } from '@/services/api';

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function DropZone({
  label, file, preview, onFile, onClear,
}: {
  label: string;
  file: File | null;
  preview: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) onFile(f);
    else toast.error('Apenas imagens são aceitas (JPG, PNG, GIF, WEBP)');
  }, [onFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
      className={cn(
        'relative rounded-xl border-2 border-dashed transition-colors cursor-pointer',
        dragging ? 'border-[#1877F2] bg-blue-50' : 'border-gray-300 hover:border-[#1877F2] hover:bg-gray-50',
        file ? 'cursor-default' : '',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {preview ? (
        <div className="relative">
          <img src={preview} alt="preview" className="w-full h-48 object-contain rounded-xl bg-gray-100" />
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute top-2 right-2 rounded-full bg-white/80 p-1 hover:bg-white shadow"
          >
            <X className="h-4 w-4 text-gray-600" />
          </button>
          <div className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white">
            {label}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <Upload className="h-8 w-8" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs">Arraste ou clique para selecionar</p>
          <p className="text-xs opacity-60">JPG, PNG, WEBP — máx 20MB</p>
        </div>
      )}
    </div>
  );
}

// ── CopyFields ────────────────────────────────────────────────────────────────

function CopyFields({
  headline, body, cta,
  onChange,
}: {
  headline: string; body: string; cta: string;
  onChange: (field: 'headline' | 'body' | 'cta', val: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Input placeholder="Headline do anúncio" value={headline}
        onChange={(e) => onChange('headline', e.target.value)}
        className="text-sm" />
      <textarea
        placeholder="Texto do anúncio (body)"
        value={body}
        onChange={(e) => onChange('body', e.target.value)}
        rows={2}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
      />
      <Input placeholder="CTA (ex: Saiba mais)" value={cta}
        onChange={(e) => onChange('cta', e.target.value)}
        className="text-sm" />
    </div>
  );
}

// ── ComparisonPanel ───────────────────────────────────────────────────────────

interface ComparisonResult {
  winner: 'A' | 'B' | 'empate';
  confidenceLevel: number;
  winnerReason: string;
  keyDifferences: string[];
  abTestRecommendation: string;
  projectedCtrDifference: string;
  analysisA: AnalysisResult;
  analysisB: AnalysisResult;
}

function ComparisonPanel({
  result, previewA, previewB,
}: {
  result: ComparisonResult;
  previewA: string | null;
  previewB: string | null;
}) {
  const items = [
    { label: 'Criativo A', analysis: result.analysisA, preview: previewA, side: 'A' as const },
    { label: 'Criativo B', analysis: result.analysisB, preview: previewB, side: 'B' as const },
  ];

  return (
    <div className="space-y-6">
      {/* Winner banner */}
      <Card className="border-2 border-[#1877F2] bg-blue-50">
        <CardContent className="pt-4 text-center space-y-1">
          <p className="text-4xl">
            {result.winner === 'A' ? '🏆 Criativo A vence!' : result.winner === 'B' ? '🏆 Criativo B vence!' : '🤝 Empate técnico'}
          </p>
          <p className="text-sm text-gray-700">{result.winnerReason}</p>
          <p className="text-xs text-muted-foreground">Confiança: {result.confidenceLevel}% · {result.projectedCtrDifference}</p>
        </CardContent>
      </Card>

      {/* Side by side */}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(({ label, analysis, preview, side }) => (
          <div key={side} className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{label}</h3>
              {result.winner === side && <span className="text-yellow-500 text-lg">🏆</span>}
              {result.winner !== side && result.winner !== 'empate' && <span className="text-gray-400 text-sm">perdedor</span>}
            </div>
            <CreativeScoreCard analysis={analysis} fileUrl={preview ?? undefined} />
          </div>
        ))}
      </div>

      {/* Key differences */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Diferenças-chave</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {result.keyDifferences.map((d, i) => (
            <p key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-[#1877F2] font-bold">{i + 1}.</span>{d}</p>
          ))}
        </CardContent>
      </Card>

      {/* A/B recommendation */}
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-4">
          <p className="text-sm font-medium text-green-800">💡 Recomendação A/B</p>
          <p className="text-sm text-green-700 mt-1">{result.abTestRecommendation}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function CreativeAnalysisPage() {
  const navigate = useNavigate();

  // Modo comparação
  const [compareMode, setCompareMode] = useState(false);
  const [withCopy, setWithCopy] = useState(false);

  // Arquivo A
  const [fileA, setFileA] = useState<File | null>(null);
  const [previewA, setPreviewA] = useState<string | null>(null);

  // Arquivo B
  const [fileB, setFileB] = useState<File | null>(null);
  const [previewB, setPreviewB] = useState<string | null>(null);

  // Copy
  const [headlineA, setHeadlineA] = useState('');
  const [bodyA, setBodyA] = useState('');
  const [ctaA, setCtaA] = useState('');
  const [headlineB, setHeadlineB] = useState('');
  const [bodyB, setBodyB] = useState('');
  const [ctaB, setCtaB] = useState('');

  // Resultados
  const [loading, setLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<{ analysis: AnalysisResult; id: string } | null>(null);
  const [compResult, setCompResult] = useState<ComparisonResult | null>(null);

  function handleFileA(f: File) {
    setFileA(f);
    setPreviewA(URL.createObjectURL(f));
    setSingleResult(null);
    setCompResult(null);
  }
  function handleFileB(f: File) {
    setFileB(f);
    setPreviewB(URL.createObjectURL(f));
    setCompResult(null);
  }
  function clearA() { setFileA(null); setPreviewA(null); setSingleResult(null); }
  function clearB() { setFileB(null); setPreviewB(null); setCompResult(null); }

  async function analyze() {
    if (!fileA) { toast.error('Selecione uma imagem'); return; }
    if (compareMode && !fileB) { toast.error('Selecione a segunda imagem para comparar'); return; }

    setLoading(true);
    setSingleResult(null);
    setCompResult(null);

    try {
      const token = getToken();
      if (compareMode) {
        const form = new FormData();
        form.append('fileA', fileA);
        form.append('fileB', fileB!);
        if (withCopy) {
          form.append('headlineA', headlineA); form.append('bodyA', bodyA); form.append('ctaA', ctaA);
          form.append('headlineB', headlineB); form.append('bodyB', bodyB); form.append('ctaB', ctaB);
        }
        const res = await fetch('/api/creative-analysis/compare', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
        const data = await res.json();
        setCompResult(data.comparison);
        toast.success('Comparação concluída!');
      } else {
        const form = new FormData();
        form.append('file', fileA);
        if (withCopy) {
          form.append('headline', headlineA);
          form.append('body', bodyA);
          form.append('cta', ctaA);
        }
        const res = await fetch('/api/creative-analysis/analyze', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
        const data = await res.json();
        setSingleResult({ analysis: data.analysis, id: data.id });
        toast.success('Análise concluída!');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao analisar');
    } finally {
      setLoading(false);
    }
  }

  const canAnalyze = fileA && (!compareMode || fileB);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Palette className="h-6 w-6 text-[#1877F2]" />
          Análise de Criativos com IA
        </h1>
        <p className="text-muted-foreground mt-1">
          Avalie imagens de anúncios com 8 critérios profissionais antes de publicar
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">

        {/* Painel de configuração */}
        <div className="space-y-4">

          {/* Toggles */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <button
                onClick={() => { setCompareMode((v) => !v); setCompResult(null); }}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                {compareMode
                  ? <ToggleRight className="h-5 w-5 text-[#1877F2]" />
                  : <ToggleLeft className="h-5 w-5 text-gray-400" />}
                Modo comparação A/B
              </button>
              <button
                onClick={() => setWithCopy((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                {withCopy
                  ? <ToggleRight className="h-5 w-5 text-[#1877F2]" />
                  : <ToggleLeft className="h-5 w-5 text-gray-400" />}
                Vincular copy ao criativo
              </button>
            </CardContent>
          </Card>

          {/* Upload(s) */}
          {compareMode ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <DropZone label="Criativo A" file={fileA} preview={previewA} onFile={handleFileA} onClear={clearA} />
                {withCopy && (
                  <CopyFields headline={headlineA} body={bodyA} cta={ctaA}
                    onChange={(f, v) => { if (f === 'headline') setHeadlineA(v); else if (f === 'body') setBodyA(v); else setCtaA(v); }} />
                )}
              </div>
              <div className="space-y-3">
                <DropZone label="Criativo B" file={fileB} preview={previewB} onFile={handleFileB} onClear={clearB} />
                {withCopy && (
                  <CopyFields headline={headlineB} body={bodyB} cta={ctaB}
                    onChange={(f, v) => { if (f === 'headline') setHeadlineB(v); else if (f === 'body') setBodyB(v); else setCtaB(v); }} />
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <DropZone label="Criativo" file={fileA} preview={previewA} onFile={handleFileA} onClear={clearA} />
              {withCopy && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Copy do anúncio</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    <CopyFields headline={headlineA} body={bodyA} cta={ctaA}
                      onChange={(f, v) => { if (f === 'headline') setHeadlineA(v); else if (f === 'body') setBodyA(v); else setCtaA(v); }} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Botão analisar */}
          <button
            onClick={analyze}
            disabled={!canAnalyze || loading}
            className={cn(
              'w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors',
              canAnalyze && !loading
                ? 'bg-[#1877F2] text-white hover:bg-[#1565c0]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed',
            )}
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Analisando com IA...</>
              : <><ImageIcon className="h-4 w-4" /> {compareMode ? 'Comparar criativos' : 'Analisar criativo'}</>}
          </button>
        </div>

        {/* Painel direito — dicas enquanto não tem resultado */}
        {!singleResult && !compResult && (
          <div className="space-y-3">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4 space-y-2 text-sm text-blue-800">
                <p className="font-semibold">O que a IA avalia:</p>
                {[
                  '📐 Hierarquia visual e composição',
                  '📝 Área de texto (regra 20%)',
                  '👤 Elemento humano',
                  '🎨 Contraste e legibilidade',
                  '🎯 Foco no produto',
                  '💡 Apelo emocional',
                  '🔘 Visibilidade do CTA',
                  '✍️ Coerência com a copy',
                ].map((item, i) => <p key={i}>{item}</p>)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-2 text-sm text-muted-foreground">
                <p className="font-semibold text-gray-700">Score por formato:</p>
                <p>📱 <strong>Feed</strong> — proporção quadrada, texto visível</p>
                <p>📲 <strong>Stories</strong> — vertical, impacto imediato</p>
                <p>🎬 <strong>Reels</strong> — dinâmico, primeiros 3s</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Resultado análise única */}
        {singleResult && !compareMode && (
          <div>
            <CreativeScoreCard
              analysis={singleResult.analysis}
              fileUrl={previewA ?? undefined}
              fileName={fileA?.name}

              onSave={() => { navigate('/creative-analysis/history'); toast.success('Análise salva!'); }}
              onUseCampaign={() => navigate('/campaigns/new')}
            />
          </div>
        )}
      </div>

      {/* Resultado comparação — full width */}
      {compResult && compareMode && (
        <ComparisonPanel result={compResult} previewA={previewA} previewB={previewB} />
      )}

      {/* Resultado análise única — full width quando modo comparação off */}
      {singleResult && !compareMode && (
        <div /> /* já renderizado acima no grid */
      )}
    </div>
  );
}
