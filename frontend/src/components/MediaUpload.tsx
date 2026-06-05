import { useRef, useState } from 'react';
import { X, Image, Video, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadedMedia {
  type: 'image' | 'video';
  url: string;
  localUrl: string;
  filename: string;
  name: string;
  hash?: string;
  videoId?: string;
  metaError?: string;
}

interface MediaUploadProps {
  value?: string;        // URL atual
  onChange: (url: string, meta?: UploadedMedia) => void;
  accept?: string;
  className?: string;
}

export function MediaUpload({ value, onChange, accept = 'image/*,video/mp4,video/quicktime', className }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(value ?? '');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');

  async function handleFile(file: File) {
    setError('');
    setLoading(true);

    // Preview local imediato
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    setMediaType(file.type.startsWith('video/') ? 'video' : 'image');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('token');
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Erro no upload');
      }

      const data: UploadedMedia = await res.json();
      setPreview(data.localUrl);
      onChange(data.localUrl, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload');
      // Mantém preview local mesmo com erro
      onChange(localPreview);
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function clear() {
    setPreview('');
    onChange('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className={cn('space-y-2', className)}>
      {preview ? (
        <div className="relative rounded-lg overflow-hidden border bg-gray-50">
          {mediaType === 'video' ? (
            <video src={preview} className="w-full max-h-48 object-contain" controls />
          ) : (
            <img src={preview} alt="Preview" className="w-full max-h-48 object-contain" />
          )}
          <button
            onClick={clear}
            className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-6 cursor-pointer hover:border-[#1877F2]/50 hover:bg-[#e7f0fd]/30 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {loading ? (
            <Loader2 className="h-7 w-7 animate-spin text-[#1877F2]" />
          ) : (
            <>
              <div className="flex gap-2 text-gray-400">
                <Image className="h-5 w-5" />
                <Video className="h-5 w-5" />
              </div>
              <p className="mt-2 text-sm font-medium text-gray-600">Clique ou arraste a mídia aqui</p>
              <p className="text-xs text-muted-foreground">JPG, PNG, GIF, MP4 · máx 100 MB</p>
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-amber-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}
