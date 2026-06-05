import { forwardRef, useState } from 'react';
import { PlacementFrame, PageAvatar } from '../PlacementFrame';
import { ctaLabel } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

// Slides simulados (em produção viriam do ad.carouselCards)
const DEMO_SLIDES = [0, 1, 2];

export const CarouselStories = forwardRef<HTMLDivElement, Props>(
  function CarouselStories({ ad, darkMode }, ref) {
    const [current, setCurrent] = useState(0);
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');
    const hasCreative = !!(ad.imageUrl || ad.videoUrl);

    return (
      <PlacementFrame
        ref={ref}
        width={375}
        height={667}
        label="Stories Carrossel"
        darkMode={darkMode}
      >
        <div className="relative w-full overflow-hidden" style={{ height: 667 }}>
          {/* Background do slide atual */}
          {hasCreative ? (
            <img
              src={ad.imageUrl}
              alt={`slide ${current + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                backgroundColor: ['#1877F2', '#e91e63', '#4caf50'][current % 3],
                border: '2px dashed #f59e0b',
              }}
            >
              <div className="text-center text-white opacity-70">
                <div style={{ fontSize: 36 }}>🖼</div>
                <p style={{ fontSize: 11 }}>Slide {current + 1}</p>
              </div>
            </div>
          )}

          {/* Overlay gradiente superior */}
          <div className="absolute top-0 left-0 right-0"
            style={{ height: 120, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }} />

          {/* Overlay gradiente inferior */}
          <div className="absolute bottom-0 left-0 right-0"
            style={{ height: 160, background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)' }} />

          {/* Bolinhas de progresso (carrossel) */}
          <div className="absolute top-3 left-3 right-3 flex gap-1">
            {DEMO_SLIDES.map((i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2,
                backgroundColor: i === current ? '#ffffff' : 'rgba(255,255,255,0.4)' }} />
            ))}
          </div>

          {/* Header */}
          <div className="absolute flex items-center gap-2 px-3" style={{ top: 14 }}>
            <div style={{ width: 32 }} />
            <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={32} darkMode={false} />
            <div>
              <p style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{ad.pageName || 'suaempresa'}</p>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>Patrocinado</p>
            </div>
            <span style={{ color: '#fff', fontSize: 22, marginLeft: 'auto' }}>✕</span>
          </div>

          {/* Setas de navegação */}
          {current > 0 && (
            <button
              onClick={() => setCurrent((c) => c - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2"
              style={{
                backgroundColor: 'rgba(255,255,255,0.3)',
                color: '#fff', borderRadius: '50%',
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700,
              }}
            >‹</button>
          )}
          {current < DEMO_SLIDES.length - 1 && (
            <button
              onClick={() => setCurrent((c) => c + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{
                backgroundColor: 'rgba(255,255,255,0.3)',
                color: '#fff', borderRadius: '50%',
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700,
              }}
            >›</button>
          )}

          {/* Indicadores bolinhas no centro */}
          <div className="absolute flex gap-1.5 items-center" style={{ bottom: 120, left: '50%', transform: 'translateX(-50%)' }}>
            {DEMO_SLIDES.map((i) => (
              <button key={i} onClick={() => setCurrent(i)}>
                <div style={{
                  width: i === current ? 8 : 6,
                  height: i === current ? 8 : 6,
                  borderRadius: '50%',
                  backgroundColor: i === current ? '#ffffff' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.2s',
                }} />
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="absolute bottom-6 left-4 right-4 text-center space-y-2">
            {ad.bodyText && (
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.4 }}>
                {ad.bodyText.slice(0, 80)}{ad.bodyText.length > 80 ? '...' : ''}
              </p>
            )}
            <div className="flex flex-col items-center gap-1">
              <span style={{ color: '#ffffff', fontSize: 18 }}>↑</span>
              <button style={{
                border: '2px solid rgba(255,255,255,0.8)',
                color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.15)',
                fontSize: 13, fontWeight: 700,
                padding: '8px 24px', borderRadius: 24,
              }}>{cta}</button>
            </div>
          </div>
        </div>
      </PlacementFrame>
    );
  },
);
