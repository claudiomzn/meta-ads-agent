import { forwardRef } from 'react';
import { PlacementFrame, PageAvatar, CreativeImage, colors } from '../PlacementFrame';
import { truncateBody } from '@/utils/text-truncation';
import { ctaLabel } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const InstagramFeed = forwardRef<HTMLDivElement, Props>(
  function InstagramFeed({ ad, darkMode }, ref) {
    const c = colors[darkMode ? 'dark' : 'light'];
    const { visible: bodyVisible, truncated } = truncateBody(ad.bodyText || '', 'ig-feed');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');

    return (
      <PlacementFrame
        ref={ref}
        width={375}
        label="Instagram Feed — Mobile"
        darkMode={darkMode}
      >
        <div style={{ backgroundColor: c.cardBg }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2">
            <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={32} darkMode={darkMode} />
            <div className="flex-1 min-w-0">
              <p style={{ color: c.text, fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{ad.pageName || 'suaempresa'}</p>
              <p style={{ color: c.sponsoredLabel, fontSize: 11 }}>Patrocinado</p>
            </div>
            <span style={{ color: c.textSecondary, fontSize: 18 }}>···</span>
          </div>

          {/* Criativo quadrado */}
          <CreativeImage
            imageUrl={ad.imageUrl}
            videoUrl={ad.videoUrl}
            aspectRatio="1 / 1"
            darkMode={darkMode}
            objectFit="cover"
          />

          {/* Ações */}
          <div className="flex items-center px-3 py-2">
            <div className="flex items-center gap-3 flex-1">
              <button style={{ fontSize: 22 }}>♡</button>
              <button style={{ fontSize: 20 }}>💬</button>
              <button style={{ fontSize: 20 }}>✈</button>
            </div>
            <button style={{ fontSize: 20 }}>🔖</button>
          </div>

          {/* Curtidas */}
          <div className="px-3">
            <p style={{ color: c.text, fontSize: 13, fontWeight: 700 }}>Curtido por outros</p>
          </div>

          {/* Copy */}
          <div className="px-3 pt-1 pb-2">
            <p style={{ color: c.text, fontSize: 13, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700 }}>{ad.pageName || 'suaempresa'} </span>
              {bodyVisible}
              {truncated && <span style={{ color: c.textSecondary }}> mais</span>}
            </p>
          </div>

          {/* CTA — faixa azul largura total */}
          <button
            style={{
              width: '100%',
              backgroundColor: '#1877F2',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 700,
              padding: '10px 0',
              textAlign: 'center',
              display: 'block',
            }}
          >
            {cta}
          </button>
        </div>
      </PlacementFrame>
    );
  },
);
