import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 3;
export const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb');
  }
  return true;
}

function trustedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const configured = (process.env.CREATIVE_IMAGE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const defaults = ['fal.media'];
  return [...defaults, ...configured].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export async function assertSafeImageUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL de imagem inválida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !trustedImageHost(url.hostname)) {
    throw new Error('Origem da imagem não permitida.');
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Destino da imagem não permitido.');
  }
  return url;
}

export async function fetchSafeImage(raw: string): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  let url = await assertSafeImageUrl(raw);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) throw new Error('Redirecionamento de imagem inválido.');
      url = await assertSafeImageUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error('Não foi possível baixar a imagem.');
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error('O arquivo remoto não é uma imagem permitida.');
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem remota excede 15 MB.');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Resposta de imagem inválida.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REMOTE_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error('Imagem remota excede 15 MB.');
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), contentType };
  }
  throw new Error('Não foi possível baixar a imagem.');
}
