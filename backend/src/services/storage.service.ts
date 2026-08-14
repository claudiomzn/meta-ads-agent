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
// Bucket "creatives": imagens geradas pelo Estúdio (comportamento legado).
// Bucket "meta-media": uploads privados do usuário, servidos apenas por URL
// assinada e temporária para a publicação no Meta.

import { fetchSafeImage } from './safe-image-url.service.js';

const BUCKET = 'creatives';
const USER_UPLOAD_BUCKET = 'meta-media';
const USER_UPLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
export function isStorageEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function signStoredObject(
  base: string,
  serviceKey: string,
  objectPath: string,
): Promise<string> {
  const response = await fetch(`${base}/storage/v1/object/sign/${USER_UPLOAD_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: USER_UPLOAD_URL_TTL_SECONDS }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    signedURL?: string;
    signedUrl?: string;
    message?: string;
  };
  const signedPath = payload.signedURL ?? payload.signedUrl;
  if (!response.ok || !signedPath) {
    console.error('[storage.service] assinatura de mídia falhou', {
      status: response.status,
      bucket: USER_UPLOAD_BUCKET,
      message: payload.message,
    });
    throw new Error('Não foi possível assinar a mídia armazenada.');
  }
  if (signedPath.startsWith('http://') || signedPath.startsWith('https://')) return signedPath;
  return `${base}/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`;
}

export async function refreshStoredMediaUrl(url: string): Promise<string> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return url;

  const prefix = `${base}/storage/v1/object/sign/${USER_UPLOAD_BUCKET}/`;
  if (!url.startsWith(prefix)) return url;

  const encodedPath = url.slice(prefix.length).split('?', 1)[0];
  if (!encodedPath) return url;
  return signStoredObject(base, serviceKey, decodeURIComponent(encodedPath));
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
  const response = await fetch(`${base}/storage/v1/object/${USER_UPLOAD_BUCKET}/${objectPath}`, {
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
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    console.error('[storage.service] upload de mídia falhou', {
      status: response.status,
      bucket: USER_UPLOAD_BUCKET,
      details: details.slice(0, 500),
    });
    throw new Error('Não foi possível armazenar a mídia.');
  }
  return signStoredObject(base, serviceKey, objectPath);
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
