import { forwardRef } from 'react';
import { PlacementFrame, PageAvatar, CreativeImage, colors } from '../PlacementFrame';
import { truncateHeadline, truncateBody, ctaLabel, extractDomain } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const FacebookFeedMobile = forwardRef<HTMLDivElement, Props>(
  function FacebookFeedMobile({ ad, darkMode }, ref) {
    const c = colors[darkMode ? 'dark' : 'light'];
    const { visible: bodyVisible, truncated } = truncateBody(ad.bodyText || '', 'fb-feed-mobile');
    const headline = truncateHeadline(ad.headline || '', 'fb-feed-mobile');
    const domain = extractDomain(ad.destinationUrl || 'seusite.com.br');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');

    return (
      <PlacementFrame
        ref={ref}
        width={375}
        label="Facebook Feed — Mobile"
        darkMode={darkMode}
      >
        <div style={{ backgroundColor: c.cardBg }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={36} darkMode={darkMode} />
            <div className="flex-1 min-w-0">
              <p style={{ color: c.text, fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{ad.pageName || 'Sua Empresa'}</p>
              <p style={{ color: c.sponsoredLabel, fontSize: 11 }} title="Conteúdo patrocinado">Patrocinado · 🌐</p>
            </div>
            <span style={{ color: c.textSecondary, fontSize: 18, lineHeight: 1 }}>···</span>
          </div>

          {/* Body text acima do criativo (comportamento mobile) */}
          {ad.bodyText && (
            <div className="px-3 pb-2">
              <p style={{ color: c.text, fontSize: 14, lineHeight: 1.5 }}>
                {bodyVisible}
                {truncated && <span style={{ color: '#1877F2' }}> ver mais</span>}
              </p>
            </div>
          )}

          {/* Criativo largura total */}
          <CreativeImage
            imageUrl={ad.imageUrl}
            videoUrl={ad.videoUrl}
            aspectRatio="1 / 1"
            darkMode={darkMode}
          />

          {/* Footer */}
          <div style={{ backgroundColor: c.surface, borderTop: `1px solid ${c.border}` }}
            className="flex items-center justify-between px-3 py-2">
            <div className="flex-1 min-w-0 mr-2">
              <p style={{ color: c.textSecondary, fontSize: 10, textTransform: 'uppercase' }}>{domain}</p>
              <p style={{ color: c.text, fontSize: 13, fontWeight: 600 }} className="truncate">{headline || 'Título do anúncio'}</p>
            </div>
            <button
              style={{
                backgroundColor: c.ctaButton,
                color: c.ctaButtonText,
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 10px',
                borderRadius: 4,
                border: `1px solid ${c.border}`,
                flexShrink: 0,
              }}
            >{cta}</button>
          </div>

          {/* Reaction bar */}
          <div style={{ backgroundColor: c.cardBg, borderTop: `1px solid ${c.border}` }}
            className="flex items-center justify-around px-2 py-1">
            {['👍 Curtir', '💬 Comentar', '↗ Compartilhar'].map((item) => (
              <button key={item} className="flex items-center gap-1 py-1 px-2">
                <span style={{ color: c.textSecondary, fontSize: 12, fontWeight: 600 }}>{item}</span>
              </button>
            ))}
          </div>
        </div>
      </PlacementFrame>
    );
  },
);
