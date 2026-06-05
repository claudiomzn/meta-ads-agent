import type { PreviewAlert } from '@/utils/preview-checklist';

interface Props {
  alerts: PreviewAlert[];
}

const iconMap = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

const bgMap = {
  error: 'rgba(239,68,68,0.08)',
  warning: 'rgba(245,158,11,0.08)',
  info: 'rgba(59,130,246,0.08)',
};

const borderMap = {
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

export function PreviewAlertPanel({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 8,
          backgroundColor: 'rgba(34,197,94,0.08)',
          border: '1px solid #22c55e',
        }}
      >
        <span style={{ fontSize: 16 }}>✅</span>
        <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
          Anúncio pronto — nenhum problema detectado.
        </p>
      </div>
    );
  }

  const errors = alerts.filter((a) => a.type === 'error');
  const warnings = alerts.filter((a) => a.type === 'warning');
  const infos = alerts.filter((a) => a.type === 'info');
  const ordered = [...errors, ...warnings, ...infos];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ordered.map((alert, idx) => (
        <div
          key={idx}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: bgMap[alert.type],
            border: `1px solid ${borderMap[alert.type]}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: 1.4 }}>{iconMap[alert.type]}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>
                {alert.message}
              </p>
              {alert.placement && (
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  Afeta: {alert.placement}
                </p>
              )}
              {alert.suggestion && (
                <p style={{ fontSize: 12, color: '#374151', marginTop: 4, lineHeight: 1.4 }}>
                  💡 {alert.suggestion}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
