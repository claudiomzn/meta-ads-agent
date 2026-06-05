import { forwardRef } from 'react';
import { PlacementFrame, PageAvatar } from '../PlacementFrame';
import { truncateBody, ctaLabel } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const InstagramStories = forwardRef<HTMLDivElement, Props>(
  function InstagramStories({ ad, darkMode }, ref) {
    const { visible: bodyVisible } = truncateBody(ad.bodyText || '', 'stories');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');

    const hasCreative = !!(ad.imageUrl || ad.videoUrl);

    return (
      <PlacementFrame
        ref={ref}
        width={375}
        height={667}
        label="Instagram Stories — Mobile"
        darkMode={darkMode}
      >
        {/* Background — criativo ou cor sólida */}
        <div className="relative w-full h-full overflow-hidden" style={{ height: 667 }}>
          {hasCreative ? (
            ad.videoUrl ? (
              <video
                src={ad.videoUrl}
                className="absolute inset-0 w-full h-full object-cover"
                muted playsInline
              />
            ) : (
              <img
                src={ad.imageUrl}
                alt="criativo"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundColor: '#1877F2', border: '2px dashed #f59e0b' }}
            >
              <div className="text-center text-white opacity-60">
                <div style={{ fontSize: 40 }}>🖼</div>
                <p style={{ fontSize: 12 }}>Criativo não definido</p>
              </div>
            </div>
          )}

          {/* Overlay gradiente superior */}
          <div
            className="absolute top-0 left-0 right-0"
            style={{ height: 120, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)' }}
          />

          {/* Overlay gradiente inferior */}
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{ height: 160, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)' }}
          />

          {/* Barra de progresso */}
          <div className="absolute top-3 left-3 right-3">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: i === 0 ? '#ffffff' : 'rgba(255,255,255,0.4)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Header overlay */}
          <div className="absolute flex items-center gap-2 px-3" style={{ top: 14 }}>
            <div style={{ width: 32 }} /> {/* espaço da progress bar */}
            <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={32} darkMode={false} />
            <div>
              <p style={{ color: '#ffffff', fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{ad.pageName || 'suaempresa'}</p>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>Patrocinado</p>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <span style={{ color: '#ffffff', fontSize: 22, lineHeight: 1 }}>✕</span>
            </div>
          </div>

          {/* Footer overlay */}
          <div className="absolute bottom-6 left-0 right-0 px-4 text-center space-y-2">
            <p style={{ color: '#ffffff', fontSize: 14, fontWeight: 700 }}>{ad.pageName || 'Sua Empresa'}</p>
            {ad.bodyText && (
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.4 }}>
                {bodyVisible}
              </p>
            )}

            {/* Swipe up / Ver mais */}
            <div className="flex flex-col items-center gap-1 pt-1">
              <span style={{ color: '#ffffff', fontSize: 18 }}>↑</span>
              <button
                style={{
                  border: '2px solid rgba(255,255,255,0.8)',
                  color: '#ffffff',
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(4px)',
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '8px 24px',
                  borderRadius: 24,
                }}
              >
                {cta}
              </button>
            </div>
          </div>
        </div>
      </PlacementFrame>
    );
  },
);
