// Armazenamento durável de imagens de criativos no Supabase Storage.
//
// As URLs do fal.ai (fal.media) são temporárias. Para arquivar um criativo,
// baixamos a imagem e re-hospedamos num bucket público do Supabase, retornando
// uma URL que não expira.
//
// Requer no ambiente:
//   SUPABASE_URL                — já usado no SSO
//   SUPABASE_SERVICE_ROLE_KEY   — nova; permite escrever no Storage
//
// Bucket: "creatives" (público). Se a service key não estiver configurada,
// rehostImage() devolve a URL original (fallback gracioso).

import { fetchSafeImage } from './safe-image-url.service.js';

const BUCKET = 'creatives';
export function isStorageEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function storeUploadedMedia(
  bytes: Buffer,
  contentType: string,
  originalName: string,
  userId: string,
): Promise<string> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) throw new Error('Storage de mídia não configurado.');
  const ext = originalName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|mp4|mov)$/)?.[1] ??
    (contentType.startsWith('video/') ? 'mp4' : 'jpg');
  const objectPath = `${userId}/meta-media/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const response = await fetch(`${base}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Não foi possível armazenar a mídia.');
  return `${base}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

/**
 * Baixa a imagem da URL de origem e re-hospeda no Supabase Storage.
 * Retorna a URL pública durável. Sem Storage configurado mantém a URL original;
 * com Storage ativo, falhas de validação/download são propagadas ao chamador.
 */
export async function rehostImage(sourceUrl: string, userId: string): Promise<string> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return sourceUrl;

  try {
    const { bytes, contentType } = await fetchSafeImage(sourceUrl);
    const ext = contentType.includes('png') ? 'png' : 'jpg';

    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const uploadRes = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: bytes as unknown as BodyInit,
    });

    if (!uploadRes.ok) {
      console.error('[storage.service] upload falhou', uploadRes.status, await uploadRes.text().catch(() => ''));
      return sourceUrl;
    }

    return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (err) {
    console.error('[storage.service] Erro ao re-hospedar imagem:', err);
    throw err;
  }
}
