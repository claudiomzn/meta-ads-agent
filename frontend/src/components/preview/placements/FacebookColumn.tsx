import { forwardRef } from 'react';
import { PlacementFrame, CreativeImage, colors } from '../PlacementFrame';
import { truncateHeadline, ctaLabel, extractDomain } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const FacebookColumn = forwardRef<HTMLDivElement, Props>(
  function FacebookColumn({ ad, darkMode }, ref) {
    const c = colors[darkMode ? 'dark' : 'light'];
    const headline = truncateHeadline(ad.headline || '', 'fb-column');
    const domain = extractDomain(ad.destinationUrl || 'seusite.com.br');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');

    // Descrição curta (1 linha ~40 chars)
    const desc = (ad.bodyText || '').slice(0, 40) + ((ad.bodyText?.length ?? 0) > 40 ? '...' : '');

    return (
      <PlacementFrame
        ref={ref}
        width={254}
        label="Facebook Coluna Direita"
        darkMode={darkMode}
      >
        <div style={{ backgroundColor: c.cardBg, border: `1px solid ${c.border}` }} className="rounded overflow-hidden m-1">
          <CreativeImage
            imageUrl={ad.imageUrl}
            videoUrl={ad.videoUrl}
            aspectRatio="1.91 / 1"
            darkMode={darkMode}
          />
          <div className="p-2 space-y-1">
            <p style={{ color: c.text, fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{headline || 'Título do anúncio'}</p>
            {desc && (
              <p style={{ color: c.textSecondary, fontSize: 11, lineHeight: 1.3 }}>{desc}</p>
            )}
            <p style={{ color: c.textSecondary, fontSize: 10, textTransform: 'uppercase' }}>{domain}</p>
            <button
              style={{
                width: '100%',
                backgroundColor: c.ctaButton,
                color: c.ctaButtonText,
                fontSize: 11,
                fontWeight: 700,
                padding: '5px 0',
                borderRadius: 4,
                border: `1px solid ${c.border}`,
                marginTop: 4,
                display: 'block',
                textAlign: 'center',
              }}
            >
              {cta}
            </button>
          </div>
        </div>
      </PlacementFrame>
    );
  },
);
