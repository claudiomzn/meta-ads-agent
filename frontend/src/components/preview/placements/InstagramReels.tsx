import { forwardRef } from 'react';
import { PlacementFrame, PageAvatar } from '../PlacementFrame';
import { truncateBody, ctaLabel } from '@/utils/text-truncation';
import type { AdPreviewData } from '@/utils/preview-checklist';

interface Props { ad: AdPreviewData; darkMode: boolean; }

export const InstagramReels = forwardRef<HTMLDivElement, Props>(
  function InstagramReels({ ad, darkMode }, ref) {
    const { visible: bodyVisible } = truncateBody(ad.bodyText || '', 'reels');
    const cta = ctaLabel(ad.cta || 'LEARN_MORE');
    const hasCreative = !!(ad.imageUrl || ad.videoUrl);

    return (
      <PlacementFrame
        ref={ref}
        width={375}
        height={667}
        label="Instagram Reels — Mobile"
        darkMode={darkMode}
      >
        <div className="relative w-full overflow-hidden" style={{ height: 667 }}>
          {/* Background */}
          {hasCreative ? (
            ad.videoUrl ? (
              <video src={ad.videoUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
            ) : (
              <img src={ad.imageUrl} alt="criativo" className="absolute inset-0 w-full h-full object-cover" />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundColor: '#1a1a2e', border: '2px dashed #f59e0b' }}>
              <div className="text-center opacity-60">
                <div style={{ fontSize: 40 }}>🎬</div>
                <p style={{ color: '#fff', fontSize: 12 }}>Criativo não definido</p>
              </div>
            </div>
          )}

          {/* Overlay escuro no rodapé */}
          <div className="absolute bottom-0 left-0 right-0"
            style={{ height: 220, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)' }} />

          {/* Ícone de som — canto superior direito */}
          <div className="absolute top-4 right-4">
            <span style={{ fontSize: 20, color: '#ffffff' }}>🔊</span>
          </div>

          {/* Ações laterais direitas */}
          <div className="absolute right-3 flex flex-col items-center gap-5" style={{ bottom: 100 }}>
            {[
              { icon: '♡', label: '' },
              { icon: '💬', label: '' },
              { icon: '↗', label: '' },
              { icon: '···', label: '' },
            ].map(({ icon }, i) => (
              <button key={i} className="flex flex-col items-center gap-0.5">
                <span style={{ color: '#ffffff', fontSize: i === 3 ? 16 : 26, lineHeight: 1 }}>{icon}</span>
              </button>
            ))}
          </div>

          {/* Rodapé esquerdo */}
          <div className="absolute bottom-10 left-3 right-14 space-y-2">
            <div className="flex items-center gap-2">
              <PageAvatar name={ad.pageName} avatarUrl={ad.pageAvatarUrl} size={28} darkMode={false} />
              <p style={{ color: '#ffffff', fontSize: 13, fontWeight: 700 }}>{ad.pageName || 'suaempresa'}</p>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>· Patrocinado</span>
            </div>

            {ad.bodyText && (
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.4 }}>
                {bodyVisible}
              </p>
            )}

            {/* Botão CTA */}
            <button
              style={{
                backgroundColor: '#ffffff',
                color: '#000000',
                fontSize: 13,
                fontWeight: 700,
                padding: '8px 16px',
                borderRadius: 4,
                display: 'inline-block',
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
