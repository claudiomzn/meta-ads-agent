import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// ── Paleta de cores modo claro/escuro ──────────────────────────────────────────
export const colors = {
  light: {
    background:     '#ffffff',
    surface:        '#f0f2f5',
    text:           '#050505',
    textSecondary:  '#65676b',
    border:         '#dadde1',
    ctaButton:      '#e4e6eb',
    ctaButtonText:  '#050505',
    ctaButtonBlue:  '#1877F2',
    sponsoredLabel: '#65676b',
    reactionBar:    '#f0f2f5',
    cardBg:         '#ffffff',
  },
  dark: {
    background:     '#18191a',
    surface:        '#3a3b3c',
    text:           '#e4e6eb',
    textSecondary:  '#b0b3b8',
    border:         '#3e4042',
    ctaButton:      '#3a3b3c',
    ctaButtonText:  '#e4e6eb',
    ctaButtonBlue:  '#1877F2',
    sponsoredLabel: '#b0b3b8',
    reactionBar:    '#3a3b3c',
    cardBg:         '#242526',
  },
} as const;

export type ColorScheme = typeof colors.light;

// ── Avatar helper ──────────────────────────────────────────────────────────────
function hashColor(str: string): string {
  const palette = ['#1877F2', '#e41e3f', '#00a400', '#f76b1c', '#7b68ee', '#00b4d8', '#e040fb'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export function PageAvatar({
  name,
  avatarUrl,
  size = 36,
  darkMode: _darkMode,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  darkMode: boolean;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover flex-shrink-0"
      />
    );
  }
  const bg = hashColor(name || 'A');
  const initial = (name || 'A')[0].toUpperCase();
  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg }}
      className="rounded-full flex items-center justify-center flex-shrink-0"
    >
      <span style={{ fontSize: size * 0.42 }} className="font-bold text-white select-none">
        {initial}
      </span>
    </div>
  );
}

// ── Criativo (imagem/vídeo/placeholder) ───────────────────────────────────────
export function CreativeImage({
  imageUrl,
  videoUrl,
  aspectRatio = '1.91 / 1',
  darkMode,
  objectFit = 'cover',
}: {
  imageUrl?: string;
  videoUrl?: string;
  aspectRatio?: string;
  darkMode: boolean;
  objectFit?: 'cover' | 'contain';
}) {
  const c = colors[darkMode ? 'dark' : 'light'];
  const hasMissing = !imageUrl && !videoUrl;

  if (hasMissing) {
    return (
      <div
        style={{
          aspectRatio,
          backgroundColor: c.surface,
          border: `2px dashed #f59e0b`,
        }}
        className="w-full flex flex-col items-center justify-center gap-1"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span style={{ fontSize: 10, color: '#f59e0b' }}>Criativo não definido</span>
      </div>
    );
  }

  if (videoUrl) {
    return (
      <div style={{ aspectRatio }} className="w-full bg-black flex items-center justify-center">
        <video src={videoUrl} style={{ width: '100%', aspectRatio, objectFit }} muted playsInline />
      </div>
    );
  }

  return (
    <div style={{ aspectRatio }} className="w-full overflow-hidden bg-black">
      <img src={imageUrl} alt="criativo" style={{ width: '100%', height: '100%', objectFit }} />
    </div>
  );
}

// ── PlacementFrame ─────────────────────────────────────────────────────────────
interface PlacementFrameProps {
  width: number;
  height?: number;
  label: string;
  darkMode: boolean;
  children: React.ReactNode;
  className?: string;
}

export const PlacementFrame = forwardRef<HTMLDivElement, PlacementFrameProps>(
  function PlacementFrame({ width, height, label, darkMode, children, className }, ref) {
    return (
      <div className={cn('flex flex-col items-center', className)}>
        <p className="text-xs font-medium text-muted-foreground mb-2 text-center">{label}</p>
        <div
          ref={ref}
          style={{
            width,
            ...(height ? { height } : {}),
            backgroundColor: colors[darkMode ? 'dark' : 'light'].background,
          }}
          className="rounded-lg shadow-md overflow-hidden"
        >
          {children}
        </div>
      </div>
    );
  },
);
