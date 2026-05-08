import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, TrendingUp, DollarSign, MousePointerClick, Eye } from 'lucide-react';
import { useCampaign } from '@/hooks/useCampaigns';
import { useMCPStatus } from '@/hooks/useMCP';
import { PublishButton } from '@/components/PublishButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id!);
  const { data: mcpStatus } = useMCPStatus();
  const [adAccountId, setAdAccountId] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');

  if (isLoading) return <div className="text-muted-foreground text-sm">Carregando...</div>;
  if (!campaign) return <div className="text-destructive">Campanha não encontrada</div>;

  const isPublished = !!campaign.metaCampaignId;
  const defaultAccount = mcpStatus?.adAccountIds?.[0] ?? '';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link to="/campaigns" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Campanhas
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium truncate">{campaign.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge variant={
              campaign.metaStatus === 'ACTIVE' ? 'success' :
              campaign.metaStatus === 'PAUSED' ? 'warning' :
              'secondary'
            }>
              {campaign.metaStatus ?? campaign.status}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{campaign.product} · {campaign.objective}</p>
        </div>

        {isPublished && campaign.metaCampaignId && (
          <a
            href={`https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${campaign.metaCampaignId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-[#1877F2] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver no Gerenciador
          </a>
        )}
      </div>

      {/* Métricas reais */}
      {campaign.metaSpend != null && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Gasto', value: formatCurrency(campaign.metaSpend ?? 0), icon: DollarSign },
            { label: 'ROAS', value: (campaign.metaRoas ?? 0).toFixed(2) + 'x', icon: TrendingUp },
            { label: 'Cliques', value: formatNumber(campaign.metaClicks ?? 0), icon: MousePointerClick },
            { label: 'Impressões', value: formatNumber(campaign.metaImpressions ?? 0), icon: Eye },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-lg bg-[#e7f0fd] p-2.5">
                  <Icon className="h-5 w-5 text-[#1877F2]" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Conjuntos de anúncios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conjuntos de anúncios ({campaign.adSets.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {campaign.adSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum conjunto criado.</p>
          ) : (
            campaign.adSets.map((as) => (
              <div key={as.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{as.name}</p>
                    <p className="text-sm text-muted-foreground">
                      R$ {as.dailyBudget}/dia · {as.optimizationGoal}
                      {as.metaAdSetId && <span className="ml-2 text-xs text-green-600">· ID: {as.metaAdSetId}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {as.metaSpend != null && (
                      <span className="text-muted-foreground">{formatCurrency(as.metaSpend)}</span>
                    )}
                    {as.metaFrequency != null && (
                      <span className={as.metaFrequency > 3.5 ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}>
                        freq {as.metaFrequency.toFixed(1)}
                        {as.metaFrequency > 3.5 && ' ⚠️'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Anúncios */}
                <div className="space-y-2 pl-4 border-l-2 border-gray-100">
                  {as.ads.map((ad) => (
                    <div key={ad.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{ad.headline}</p>
                        <p className="text-xs text-muted-foreground truncate">{ad.bodyText}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {ad.metaCtr != null && (
                          <p className={`text-xs ${ad.metaCtr < 1 && (ad.metaSpend ?? 0) > 50 ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            CTR {formatPercent(ad.metaCtr)}
                          </p>
                        )}
                        {ad.metaAdId && (
                          <p className="text-xs text-green-600">publicado</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Publicação */}
      {!isPublished && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publicar no Meta Ads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!mcpStatus?.connected ? (
              <div className="rounded-lg bg-gray-50 border-dashed border-2 p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Conecte o Meta Ads para publicar esta campanha</p>
                <Button asChild variant="meta" size="sm">
                  <Link to="/onboarding">Conectar agora</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Conta de anúncios</label>
                    <Input
                      placeholder={defaultAccount || 'act_123456789'}
                      value={adAccountId || defaultAccount}
                      onChange={(e) => setAdAccountId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">URL de destino padrão</label>
                    <Input
                      placeholder="https://seusite.com/pagina"
                      value={destinationUrl}
                      onChange={(e) => setDestinationUrl(e.target.value)}
                    />
                  </div>
                </div>

                <PublishButton
                  campaign={campaign}
                  adAccountId={adAccountId || defaultAccount}
                  destinationUrl={destinationUrl || 'https://seusite.com'}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isPublished && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
          <p className="text-sm text-green-800">
            Campanha publicada no Meta Ads.
            {campaign.publishedAt && <span className="ml-1 text-green-600">Publicado em {new Date(campaign.publishedAt).toLocaleDateString('pt-BR')}.</span>}
            {campaign.lastSyncAt && <span className="ml-1 text-green-600">Sincronizado em {new Date(campaign.lastSyncAt).toLocaleDateString('pt-BR')}.</span>}
          </p>
        </div>
      )}
    </div>
  );
}
