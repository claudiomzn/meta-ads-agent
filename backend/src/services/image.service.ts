// Geração de imagem para criativos via fal.ai (Flux 1.1 Pro).
//
// Ativa-se automaticamente quando FAL_KEY está configurada no ambiente.
// Sem a key, generateImage() retorna null (o funil continua funcionando com
// o conceito visual + copy; a arte real "liga" assim que a key for adicionada).

const FAL_ENDPOINT = 'https://fal.run/fal-ai/flux-pro/v1.1';

// Proporções do Meta → tamanhos aceitos pelo Flux
export type CreativeAspect = '1:1' | '4:5' | '9:16';

const ASPECT_TO_SIZE: Record<CreativeAspect, string> = {
  '1:1': 'square_hd',
  '4:5': 'portrait_4_3',
  '9:16': 'portrait_16_9',
};

export function isImageGenEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

/**
 * Gera uma imagem a partir de um prompt. Retorna a URL hospedada pela fal.ai,
 * ou null se a geração estiver desativada (sem FAL_KEY) ou falhar.
 */
export async function generateImage(
  prompt: string,
  aspect: CreativeAspect = '1:1',
): Promise<string | null> {
  const key = process.env.FAL_KEY;
  if (!key) return null;

  try {
    const res = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: ASPECT_TO_SIZE[aspect],
        num_images: 1,
        output_format: 'jpeg',
        enable_safety_checker: true,
      }),
    });

    if (!res.ok) {
      console.error('[image.service] fal.ai respondeu', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data = (await res.json()) as { images?: { url: string }[] };
    return data.images?.[0]?.url ?? null;
  } catch (err) {
    console.error('[image.service] Erro ao gerar imagem:', err);
    return null;
  }
}

/**
 * Gera várias imagens em paralelo. Mantém a ordem dos prompts.
 */
export async function generateImages(
  prompts: string[],
  aspect: CreativeAspect = '1:1',
): Promise<(string | null)[]> {
  return Promise.all(prompts.map((p) => generateImage(p, aspect)));
}
