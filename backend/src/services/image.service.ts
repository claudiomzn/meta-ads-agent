// Geração de imagem para criativos via fal.ai.
//
// Modelo padrão: Ideogram v3 (excelente para anúncios — renderiza texto/oferta
// legível dentro da arte, ideal para o mercado de performance brasileiro).
//
// Ativa-se automaticamente quando FAL_KEY está configurada no ambiente.
// Sem a key, generateImage() retorna null (o funil continua funcionando com
// o conceito visual + copy; a arte real "liga" assim que a key for adicionada).
//
// Configurável por env (sem precisar mexer no código):
//   FAL_KEY             — credencial do fal.ai (obrigatória para gerar)
//   FAL_IMAGE_MODEL     — id do modelo (default: fal-ai/ideogram/v3)
//   FAL_RENDERING_SPEED — TURBO | BALANCED | QUALITY (default: QUALITY)

const FAL_BASE = 'https://fal.run';

// Proporções do Meta → tamanhos aceitos pelo fal (image_size)
export type CreativeAspect = '1:1' | '4:5' | '9:16';

const ASPECT_TO_SIZE: Record<CreativeAspect, string> = {
  '1:1': 'square_hd',
  '4:5': 'portrait_4_3',
  '9:16': 'portrait_16_9',
};

function modelId(): string {
  return process.env.FAL_IMAGE_MODEL ?? 'fal-ai/ideogram/v3';
}

function renderingSpeed(): string {
  return process.env.FAL_RENDERING_SPEED ?? 'QUALITY';
}

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
    const res = await fetch(`${FAL_BASE}/${modelId()}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: ASPECT_TO_SIZE[aspect],
        rendering_speed: renderingSpeed(),
        num_images: 1,
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
