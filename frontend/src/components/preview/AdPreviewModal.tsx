import { useRef, useState } from 'react';
import type { AdPreviewData } from '@/utils/preview-checklist';
import { generateAlerts } from '@/utils/preview-checklist';
import { downloadPreviewAsPng } from '@/utils/download-preview';
import { PreviewAlertPanel } from './PreviewAlertPanel';

// Placements
import { FacebookFeedDesktop } from './placements/FacebookFeedDesktop';
import { FacebookFeedMobile } from './placements/FacebookFeedMobile';
import { InstagramFeed } from './placements/InstagramFeed';
import { InstagramStories } from './placements/InstagramStories';
import { InstagramReels } from './placements/InstagramReels';
import { FacebookColumn } from './placements/FacebookColumn';
import { CarouselStories } from './placements/CarouselStories';

export interface AdPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  ad: AdPreviewData;
}

type Tab = {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
};

const TABS: Tab[] = [
  { id: 'fb-feed-desktop', label: 'Feed Desktop', shortLabel: 'FB Desktop', icon: '🖥' },
  { id: 'fb-feed-mobile', label: 'Feed Mobile', shortLabel: 'FB Mobile', icon: '📱' },
  { id: 'ig-feed', label: 'Instagram Feed', shortLabel: 'IG Feed', icon: '📸' },
  { id: 'ig-stories', label: 'Instagram Stories', shortLabel: 'Stories', icon: '⭕' },
  { id: 'ig-reels', label: 'Instagram Reels', shortLabel: 'Reels', icon: '🎬' },
  { id: 'fb-column', label: 'Coluna Direita', shortLabel: 'Coluna', icon: '📋' },
  { id: 'carousel-stories', label: 'Carrossel Stories', shortLabel: 'Carrossel', icon: '🔄' },
];

export function AdPreviewModal({ isOpen, onClose, ad }: AdPreviewModalProps) {
  const [activeTab, setActiveTab] = useState('fb-feed-desktop');
  const [darkMode, setDarkMode] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const alerts = generateAlerts(ad);

  if (!isOpen) return null;

  async function handleDownload() {
    if (!previewRef.current) return;
    setDownloading(true);
    try {
      const filename = `preview-${activeTab}-${Date.now()}.png`;
      await downloadPreviewAsPng(previewRef.current, filename);
    } finally {
      setDownloading(false);
    }
  }

  function renderPlacement() {
    const props = { ad, darkMode, ref: previewRef };
    switch (activeTab) {
      case 'fb-feed-desktop':   return <FacebookFeedDesktop {...props} />;
      case 'fb-feed-mobile':    return <FacebookFeedMobile  {...props} />;
      case 'ig-feed':           return <InstagramFeed       {...props} />;
      case 'ig-stories':        return <InstagramStories    {...props} />;
      case 'ig-reels':          return <InstagramReels      {...props} />;
      case 'fb-column':         return <FacebookColumn      {...props} />;
      case 'carousel-stories':  return <CarouselStories     {...props} />;
      default:                  return null;
    }
  }

  const errorCount   = alerts.filter((a) => a.type === 'error').length;
  const warningCount = alerts.filter((a) => a.type === 'warning').length;

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 24, paddingBottom: 24,
        overflowY: 'auto',
      }}
    >
      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 860,
          backgroundColor: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'hidden',
          margin: '0 16px',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>👁</span>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>
                Prévia do Anúncio
              </h2>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                Como aparecerá em cada placement do Meta
              </p>
            </div>
            {/* Badge de alertas */}
            {(errorCount > 0 || warningCount > 0) && (
              <div style={{ display: 'flex', gap: 6 }}>
                {errorCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px',
                    borderRadius: 99, backgroundColor: '#fee2e2', color: '#dc2626',
                  }}>
                    {errorCount} erro{errorCount > 1 ? 's' : ''}
                  </span>
                )}
                {warningCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px',
                    borderRadius: 99, backgroundColor: '#fef3c7', color: '#d97706',
                  }}>
                    {warningCount} aviso{warningCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Dark mode toggle */}
            <button
              onClick={() => setDarkMode((d) => !d)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid #d1d5db',
                backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                color: darkMode ? '#f9fafb' : '#374151',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {darkMode ? '☀️ Claro' : '🌙 Escuro'}
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                backgroundColor: '#1877F2', color: '#ffffff',
                border: 'none', fontSize: 13, fontWeight: 700,
                cursor: downloading ? 'not-allowed' : 'pointer',
                opacity: downloading ? 0.7 : 1,
              }}
            >
              {downloading ? '⏳ Gerando...' : '⬇️ Baixar PNG'}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid #e5e7eb', backgroundColor: '#f9fafb',
                fontSize: 18, cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#6b7280',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div
          style={{
            display: 'flex', gap: 4, padding: '12px 24px 0',
            borderBottom: '1px solid #e5e7eb', flexShrink: 0,
            overflowX: 'auto',
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '8px 14px', borderRadius: '8px 8px 0 0',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
                backgroundColor: activeTab === tab.id ? '#1877F2' : 'transparent',
                color: activeTab === tab.id ? '#ffffff' : '#6b7280',
                borderBottom: activeTab === tab.id ? '2px solid #1877F2' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.shortLabel}</span>
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div
          style={{
            flex: 1, overflowY: 'auto',
            padding: 24,
            backgroundColor: darkMode ? '#111827' : '#f3f4f6',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}
        >
          {/* Alert panel */}
          <div style={{ backgroundColor: darkMode ? '#1f2937' : '#ffffff', borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Checklist de qualidade
            </p>
            <PreviewAlertPanel alerts={alerts} />
          </div>

          {/* Preview */}
          <div
            style={{
              display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
              backgroundColor: darkMode ? '#1f2937' : '#ffffff',
              borderRadius: 12, padding: 24,
            }}
          >
            {renderPlacement()}
          </div>

          {/* Ad metadata */}
          <div
            style={{
              backgroundColor: darkMode ? '#1f2937' : '#ffffff',
              borderRadius: 12, padding: 16,
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Dados do anúncio
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MetaField label="Headline" value={ad.headline} darkMode={darkMode} />
              <MetaField label="CTA" value={ad.cta} darkMode={darkMode} />
              <MetaField label="URL de destino" value={ad.destinationUrl} darkMode={darkMode} />
              <MetaField label="Página" value={ad.pageName} darkMode={darkMode} />
            </div>
            {ad.bodyText && (
              <div style={{ marginTop: 12 }}>
                <MetaField label="Texto do anúncio" value={ad.bodyText} darkMode={darkMode} multiline />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value, darkMode, multiline }: { label: string; value: string; darkMode: boolean; multiline?: boolean }) {
  const textColor = darkMode ? '#e5e7eb' : '#111827';
  const labelColor = darkMode ? '#9ca3af' : '#6b7280';
  const bgColor = darkMode ? '#374151' : '#f9fafb';
  return (
    <div style={{ backgroundColor: bgColor, borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ fontSize: 11, color: labelColor, fontWeight: 600, marginBottom: 2 }}>{label}</p>
      <p style={{
        fontSize: 13, color: textColor, lineHeight: 1.4,
        wordBreak: 'break-word',
        display: multiline ? undefined : '-webkit-box',
        WebkitLineClamp: multiline ? undefined : 2,
        WebkitBoxOrient: multiline ? undefined : 'vertical' as const,
        overflow: multiline ? undefined : 'hidden',
      }}>
        {value || <span style={{ color: labelColor, fontStyle: 'italic' }}>Não informado</span>}
      </p>
    </div>
  );
}
