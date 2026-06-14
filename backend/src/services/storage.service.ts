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

const BUCKET = 'creatives';

export function isStorageEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Baixa a imagem da URL de origem e re-hospeda no Supabase Storage.
 * Retorna a URL pública durável, ou a URL original se o storage não estiver
 * configurado / em caso de falha (nunca lança).
 */
export async function rehostImage(sourceUrl: string, userId: string): Promise<string> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return sourceUrl;

  try {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) return sourceUrl;

    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const bytes = Buffer.from(await imgRes.arrayBuffer());

    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const uploadRes = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: bytes,
    });

    if (!uploadRes.ok) {
      console.error('[storage.service] upload falhou', uploadRes.status, await uploadRes.text().catch(() => ''));
      return sourceUrl;
    }

    return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (err) {
    console.error('[storage.service] Erro ao re-hospedar imagem:', err);
    return sourceUrl;
  }
}
