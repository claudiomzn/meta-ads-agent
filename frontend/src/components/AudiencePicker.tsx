import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Users, ChevronDown, X } from 'lucide-react';

interface AudienceRecord {
  id: string;
  name: string;
  interests: string;
  behaviors?: string;
  ageMin: number;
  ageMax: number;
  gender: string;
  locations: string;
  estimatedSize?: number;
}

const GENDER_LABELS: Record<string, string> = {
  all: 'Todos',
  male: 'Homens',
  female: 'Mulheres',
};

interface Props {
  /** ID do público selecionado */
  value: string | null;
  /** Chamado com o objeto completo ao selecionar, ou null ao limpar */
  onChange: (audience: AudienceRecord | null) => void;
  /** Label descritiva acima do picker */
  label?: string;
  /** Texto do placeholder quando nenhum público está selecionado */
  placeholder?: string;
}

export function AudiencePicker({ value, onChange, label, placeholder }: Props) {
  const { data: audiences = [], isLoading } = useQuery<AudienceRecord[]>({
    queryKey: ['audiences'],
    queryFn: () => api.get('/audiences'),
  });

  const selected = audiences.find((a) => a.id === value) ?? null;

  if (isLoading) {
    return (
      <div className="h-9 rounded-md border border-input bg-muted animate-pulse" />
    );
  }

  if (audiences.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Nenhum público salvo. Crie em <strong>Públicos</strong>.</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      )}

      {selected ? (
        /* Público selecionado — card compacto com botão de limpar */
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <Users className="h-3.5 w-3.5 mt-0.5 text-blue-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-900 truncate">{selected.name}</p>
            <p className="text-xs text-blue-700 mt-0.5 truncate">
              {GENDER_LABELS[selected.gender]} · {selected.ageMin}–{selected.ageMax} anos · {selected.locations.split(',')[0].trim()}
            </p>
            {selected.interests && (
              <p className="text-xs text-blue-600 truncate mt-0.5">
                {selected.interests.split(',').slice(0, 3).join(', ')}
              </p>
            )}
          </div>
          <button
            onClick={() => onChange(null)}
            className="flex-shrink-0 rounded p-0.5 hover:bg-blue-200 text-blue-500 hover:text-blue-700"
            title="Remover público"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        /* Dropdown de seleção */
        <div className="relative">
          <select
            className="w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            value=""
            onChange={(e) => {
              const aud = audiences.find((a) => a.id === e.target.value);
              if (aud) onChange(aud);
            }}
          >
            <option value="" disabled>
              {placeholder ?? '🎯 Selecionar público salvo...'}
            </option>
            {audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {GENDER_LABELS[a.gender]} {a.ageMin}–{a.ageMax} · {a.locations.split(',')[0].trim()}
                {a.estimatedSize ? ` · ~${Math.round(a.estimatedSize / 1000)}k` : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/** Converte um AudienceRecord em texto descritivo para o campo de copy/audience */
export function audienceToText(a: AudienceRecord): string {
  const parts: string[] = [];
  const gender = GENDER_LABELS[a.gender] ?? a.gender;
  parts.push(`${gender}, ${a.ageMin}–${a.ageMax} anos`);
  if (a.locations) parts.push(a.locations);
  if (a.interests) parts.push(`Interesses: ${a.interests}`);
  if (a.behaviors) parts.push(`Comportamentos: ${a.behaviors}`);
  return parts.join(' | ');
}
