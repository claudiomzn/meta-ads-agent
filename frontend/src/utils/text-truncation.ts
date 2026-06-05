export type PlacementType =
  | 'fb-feed-desktop'
  | 'fb-feed-mobile'
  | 'ig-feed'
  | 'stories'
  | 'reels'
  | 'fb-column';

export function truncateHeadline(text: string, placement: PlacementType): string {
  const limits: Record<PlacementType, number> = {
    'fb-feed-desktop': 25,
    'fb-feed-mobile':  40,
    'ig-feed':         40,
    'stories':         30,
    'reels':           30,
    'fb-column':       25,
  };
  const limit = limits[placement];
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

export function truncateBody(
  text: string,
  placement: PlacementType,
): { visible: string; truncated: boolean } {
  const lineLimits: Record<PlacementType, number> = {
    'fb-feed-desktop': 3,
    'fb-feed-mobile':  3,
    'ig-feed':         2,
    'stories':         2,
    'reels':           2,
    'fb-column':       1,
  };
  const charsPerLine = 60;
  const maxChars = lineLimits[placement] * charsPerLine;
  if (text.length <= maxChars) return { visible: text, truncated: false };
  return { visible: text.slice(0, maxChars), truncated: true };
}

export function ctaLabel(ctaCode: string): string {
  const map: Record<string, string> = {
    SAIBA_MAIS:           'Saiba mais',
    LEARN_MORE:           'Saiba mais',
    FALAR_NO_WHATSAPP:    'Enviar mensagem',
    WHATSAPP_MESSAGE:     'Enviar mensagem',
    SOLICITAR_ORCAMENTO:  'Solicitar orçamento',
    COMPRAR_AGORA:        'Comprar agora',
    SHOP_NOW:             'Comprar agora',
    INSCREVER_SE:         'Inscrever-se',
    SUBSCRIBE:            'Inscrever-se',
    BAIXAR:               'Baixar',
    DOWNLOAD:             'Baixar',
    CADASTRAR:            'Cadastrar',
    SIGN_UP:              'Cadastrar',
    ENTRAR_EM_CONTATO:    'Entrar em contato',
    CONTACT_US:           'Entrar em contato',
    VER_MAIS:             'Ver mais',
    SEE_MORE:             'Ver mais',
    OBTER_OFERTA:         'Obter oferta',
    GET_OFFER:            'Obter oferta',
    CALL_NOW:             'Ligar agora',
    BOOK_NOW:             'Reservar',
    APPLY_NOW:            'Candidatar-se',
  };
  return map[ctaCode] ?? 'Saiba mais';
}

export function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`)
      .hostname.toUpperCase().replace('WWW.', '');
  } catch {
    return url.toUpperCase().replace('HTTPS://', '').replace('HTTP://', '').replace('WWW.', '');
  }
}
