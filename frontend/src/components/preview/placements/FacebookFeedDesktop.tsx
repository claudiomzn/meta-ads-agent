import { forwardRef } from 'react';
import { PlacementFrame, PageAvatar, CreativeImage, colors } from '../PlacementFrame';
import { truncateHeadline, truncateBody, ctaLabel, extractDomain } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const FacebookFeedDesktop = forwardRef<HTMLDivElement, Props>(
  function FacebookFeedDesktop({ ad, darkMode }, ref) {
    const c = colors[darkMode ? 'dark' : 'light'];
    const { visible: bodyVisible, truncated } = truncateBody(ad.bodyText || '', 'fb-feed-desktop');
    const headline = truncateHeadline(ad.headline || '', 'fb-feed-desktop');
    const domain = extractDomain(ad.destinationUrl || 'seusite.com.br');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');

    return (
      <PlacementFrame
        ref={ref}
        width={500}
        label="Facebook Feed — Desktop"
        darkMode={darkMode}
      >
        {/* Card */}
        <div style={{ backgroundColor: c.cardBg, border: `1px solid ${c.border}` }} className="rounded-lg overflow-hidden mx-2 my-2">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={40} darkMode={darkMode} />
            <div className="flex-1 min-w-0">
              <p style={{ color: c.text, fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{ad.pageName || 'Sua Empresa'}</p>
              <p style={{ color: c.sponsoredLabel, fontSize: 12 }} title="Conteúdo patrocinado">
                Patrocinado · <span style={{ fontSize: 10 }}>🌐</span>
              </p>
            </div>
            <span style={{ color: c.textSecondary, fontSize: 20, lineHeight: 1 }}>···</span>
          </div>

          {/* Body text */}
          {ad.bodyText && (
            <div className="px-3 pb-2">
              <p style={{ color: c.text, fontSize: 14, lineHeight: 1.5 }}>
                {bodyVisible}{truncated && <span style={{ color: '#1877F2', cursor: 'pointer' }}> ver mais</span>}
              </p>
            </div>
          )}

          {/* Criativo */}
          <CreativeImage
            imageUrl={ad.imageUrl}
            videoUrl={ad.videoUrl}
            aspectRatio="1.91 / 1"
            darkMode={darkMode}
          />

          {/* Footer */}
          <div style={{ backgroundColor: c.surface, borderTop: `1px solid ${c.border}` }}
            className="flex items-center justify-between px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p style={{ color: c.textSecondary, fontSize: 11, textTransform: 'uppercase' }}>{domain}</p>
              <p style={{ color: c.text, fontSize: 14, fontWeight: 600 }} className="truncate">{headline || 'Título do anúncio'}</p>
            </div>
            <button
              style={{
                backgroundColor: c.ctaButton,
                color: c.ctaButtonText,
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 4,
                border: `1px solid ${c.border}`,
                flexShrink: 0,
                marginLeft: 8,
              }}
            >
              {cta}
            </button>
          </div>

          {/* Reaction bar */}
          <div style={{ backgroundColor: c.cardBg, borderTop: `1px solid ${c.border}` }}
            className="flex items-center justify-around px-3 py-1.5">
            {[
              { emoji: '👍', label: 'Curtir' },
              { emoji: '💬', label: 'Comentar' },
              { emoji: '↗', label: 'Compartilhar' },
            ].map(({ emoji, label }) => (
              <button key={label} className="flex items-center gap-1.5 py-1 px-3 rounded hover:opacity-70">
                <span style={{ fontSize: 16 }}>{emoji}</span>
                <span style={{ color: c.textSecondary, fontSize: 13, fontWeight: 600 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </PlacementFrame>
    );
  },
);
