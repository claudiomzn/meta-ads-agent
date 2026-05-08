import { useState } from 'react';
import { Instagram, Sparkles, Heart, MessageCircle, Eye, Bookmark, TrendingUp, TrendingDown, Clock, Film, Loader2, ExternalLink, RefreshCw, Users } from 'lucide-react';
import { useInstagramPosts, useInstagramAnalyze, IGPost, IGAnalysis } from '@/hooks/useInstagram';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MEDIA_LABELS: Record<string, string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  CAROUSEL_ALBUM: 'Carrossel',
  REELS: 'Reels',
};

const MEDIA_COLORS: Record<string, string> = {
  IMAGE: 'bg-blue-100 text-blue-700',
  VIDEO: 'bg-purple-100 text-purple-700',
  CAROUSEL_ALBUM: 'bg-orange-100 text-orange-700',
  REELS: 'bg-pink-100 text-pink-700',
};

function fmt(n?: number) {
  if (!n) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function PostCard({ post, highlight }: { post: IGPost; highlight?: 'best' | 'worst' }) {
  const date = new Date(post.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  return (
    <Card className={cn(
      'overflow-hidden transition-shadow hover:shadow-md',
      highlight === 'best' && 'ring-2 ring-green-400',
      highlight === 'worst' && 'ring-2 ring-red-300',
    )}>
      {/* Thumbnail */}
      <div className="relative h-36 bg-gray-100">
        {post.media_url || post.thumbnail_url ? (
          <img
            src={post.thumbnail_url ?? post.media_url}
            alt="post"
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Instagram className="h-8 w-8 text-gray-300" />
          </div>
        )}
        <span className={cn(
          'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          MEDIA_COLORS[post.media_type] ?? 'bg-gray-100 text-gray-600',
        )}>
          {MEDIA_LABELS[post.media_type] ?? post.media_type}
        </span>
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <CardContent className="p-3 space-y-2">
        {post.caption && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{post.caption}</p>
        )}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{date}</span>
        </div>
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { icon: Heart, val: post.like_count, label: 'Curtidas' },
            { icon: MessageCircle, val: post.comments_count, label: 'Comentários' },
            { icon: Eye, val: post.insights?.reach, label: 'Alcance' },
            { icon: Bookmark, val: post.insights?.saved, label: 'Salvos' },
          ].map(({ icon: Icon, val, label }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold">{fmt(val)}</span>
              <span className="text-[9px] text-muted-foreground leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AnalysisView({ analysis, posts }: { analysis: IGAnalysis; posts: IGPost[] }) {
  const postMap = Object.fromEntries(posts.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card className="bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200">
        <CardContent className="pt-4">
          <p className="text-sm font-medium text-purple-900">{analysis.summary}</p>
        </CardContent>
      </Card>

      {/* Highlights */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-green-700">
            <TrendingUp className="h-4 w-4" /> Melhores posts
          </h3>
          <div className="space-y-2">
            {analysis.bestPosts?.slice(0, 3).map(({ id, reason }) => (
              <div key={id} className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                {postMap[id] && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn('rounded-full px-2 py-0.5', MEDIA_COLORS[postMap[id].media_type])}>
                      {MEDIA_LABELS[postMap[id].media_type]}
                    </span>
                    <span>❤️ {fmt(postMap[id].like_count)} · 👁 {fmt(postMap[id].insights?.reach)}</span>
                  </div>
                )}
                <p className="text-green-800">{reason}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-red-600">
            <TrendingDown className="h-4 w-4" /> Posts com baixo desempenho
          </h3>
          <div className="space-y-2">
            {analysis.worstPosts?.slice(0, 3).map(({ id, reason }) => (
              <div key={id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                {postMap[id] && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn('rounded-full px-2 py-0.5', MEDIA_COLORS[postMap[id].media_type])}>
                      {MEDIA_LABELS[postMap[id].media_type]}
                    </span>
                    <span>❤️ {fmt(postMap[id].like_count)} · 👁 {fmt(postMap[id].insights?.reach)}</span>
                  </div>
                )}
                <p className="text-red-800">{reason}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Padrões */}
      {analysis.patterns?.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-yellow-500" /> Padrões identificados
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.patterns.map((p, i) => (
              <Card key={i} className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-4 space-y-1">
                  <p className="font-medium text-yellow-900 text-sm">{p.title}</p>
                  <p className="text-xs text-yellow-800">{p.insight}</p>
                  <p className="text-xs font-medium text-yellow-700">→ {p.recommendation}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Dicas rápidas */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-900 text-sm">Melhor horário</p>
              <p className="text-sm text-blue-800">{analysis.bestTime}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="p-4 flex items-start gap-3">
            <Film className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-purple-900 text-sm">Formato vencedor</p>
              <p className="text-sm text-purple-800">{analysis.bestType}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sugestões */}
      {analysis.suggestions?.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold">💡 Sugestões de conteúdo</h3>
          <div className="space-y-2">
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border bg-white p-3 text-sm">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-pink-100 text-[11px] font-bold text-pink-700">
                  {i + 1}
                </span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InstagramPage() {
  const [tab, setTab] = useState<'posts' | 'analysis'>('posts');
  const [analysisData, setAnalysisData] = useState<{ posts: IGPost[]; analysis: IGAnalysis } | null>(null);

  const postsQuery = useInstagramPosts();
  const analyze = useInstagramAnalyze();

  const data = postsQuery.data;
  const error = postsQuery.error?.message || analyze.error?.message;

  async function runAnalysis() {
    const result = await analyze.mutateAsync();
    setAnalysisData({ posts: result.posts, analysis: result.analysis! });
    setTab('analysis');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Instagram className="h-6 w-6 text-pink-500" />
            Instagram Orgânico
          </h1>
          <p className="mt-1 text-muted-foreground">Análise de posts e performance da sua conta</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => postsQuery.refetch()} disabled={postsQuery.isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', postsQuery.isFetching && 'animate-spin')} />
            Atualizar
          </Button>
          <Button
            className="bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600"
            size="sm"
            onClick={runAnalysis}
            disabled={analyze.isPending}
          >
            {analyze.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando...</>
              : <><Sparkles className="h-3.5 w-3.5" /> Analisar com IA</>
            }
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive bg-red-50">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Loading */}
      {postsQuery.isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-pink-500 mx-auto" />
            <p className="text-muted-foreground text-sm">Buscando seus posts do Instagram...</p>
          </div>
        </div>
      )}

      {/* Account card */}
      {data?.account && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4">
              {data.account.profile_picture_url && (
                <img
                  src={data.account.profile_picture_url}
                  alt="profile"
                  className="h-14 w-14 rounded-full object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold">@{data.account.username}</p>
                {data.account.biography && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{data.account.biography}</p>
                )}
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <p className="text-lg font-bold">{data.account.followers_count?.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Seguidores</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{data.account.media_count}</p>
                  <p className="text-xs text-muted-foreground">Posts</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      {(data?.posts || analysisData) && (
        <>
          <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
            {(['posts', 'analysis'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                  tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'posts' ? `Posts (${data?.posts.length ?? 0})` : '🧠 Análise IA'}
              </button>
            ))}
          </div>

          {/* Posts grid */}
          {tab === 'posts' && data?.posts && (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {data.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  highlight={
                    analysisData?.analysis.bestPosts?.some((p) => p.id === post.id)
                      ? 'best'
                      : analysisData?.analysis.worstPosts?.some((p) => p.id === post.id)
                      ? 'worst'
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Analysis */}
          {tab === 'analysis' && analysisData && (
            <AnalysisView analysis={analysisData.analysis} posts={analysisData.posts} />
          )}

          {tab === 'analysis' && !analysisData && (
            <Card>
              <CardHeader>
                <CardTitle>Análise IA</CardTitle>
                <CardDescription>
                  Clique em "Analisar com IA" para gerar insights sobre seus posts do Instagram.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
