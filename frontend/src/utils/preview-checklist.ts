export interface PreviewAlert {
  type: 'error' | 'warning' | 'info';
  placement?: string;
  message: string;
  suggestion: string;
}

export interface AdPreviewData {
  headline: string;
  bodyText: string;
  cta: string;
  destinationUrl: string;
  imageUrl?: string;
  videoUrl?: string;
  pageName: string;
  pageAvatarUrl?: string;
}

export function generateAlerts(ad: AdPreviewData): PreviewAlert[] {
  const alerts: PreviewAlert[] = [];

  // 1. Copy longa para mobile
  if (ad.bodyText.length > 125) {
    alerts.push({
      type: 'warning',
      placement: 'Feed Mobile',
      message: `Texto com ${ad.bodyText.length} caracteres — truncado em mobile`,
      suggestion: 'Reduza para menos de 125 caracteres para exibição completa',
    });
  }

  // 2. Headline longa
  if (ad.headline.length > 27) {
    alerts.push({
      type: 'warning',
      placement: 'Feed Desktop / Coluna',
      message: `Headline com ${ad.headline.length} chars — truncada em alguns placements`,
      suggestion: 'Mantenha a headline abaixo de 27 caracteres',
    });
  }

  // 3. Sem URL de destino
  if (!ad.destinationUrl || ad.destinationUrl.trim() === '') {
    alerts.push({
      type: 'error',
      message: 'URL de destino não informada',
      suggestion: 'Adicione a URL da landing page ou WhatsApp antes de publicar',
    });
  }

  // 4. Sem criativo
  if (!ad.imageUrl && !ad.videoUrl) {
    alerts.push({
      type: 'warning',
      message: 'Anúncio sem criativo visual',
      suggestion: 'Anúncios com imagem têm CTR significativamente maior',
    });
  }

  // 5. CTA genérico
  if (!ad.cta || ad.cta === 'SAIBA_MAIS' || ad.cta === 'LEARN_MORE') {
    alerts.push({
      type: 'info',
      message: 'CTA genérico "Saiba mais"',
      suggestion: 'CTAs específicos como "Solicitar orçamento" aumentam conversão',
    });
  }

  // 6. Nome da página ausente
  if (!ad.pageName || ad.pageName === 'Sua Empresa') {
    alerts.push({
      type: 'info',
      message: 'Nome da página usando placeholder',
      suggestion: 'Configure o nome da sua empresa nas Configurações',
    });
  }

  return alerts;
}
