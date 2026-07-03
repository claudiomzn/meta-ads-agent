// Gerencia instâncias da Evolution API central do AdsGenius (uma por usuário).
// É o que torna o WhatsApp "1 clique + QR code" para o cliente leigo, em vez
// de exigir que ele hospede a própria Evolution e cole URL/chave/webhook.
//
// Env necessárias (Render):
//   EVOLUTION_URL      — URL da Evolution API central (ex: https://evolution-api-xxxx.onrender.com)
//   EVOLUTION_API_KEY  — AUTHENTICATION_API_KEY dessa Evolution
//   PUBLIC_URL         — URL pública DESTE backend (p/ montar o webhook)

const PUBLIC_URL_DEFAULT = 'https://meta-ads-agent-backend.onrender.com';

export function evolutionConfigured(): boolean {
  return !!(process.env.EVOLUTION_URL && process.env.EVOLUTION_API_KEY);
}

function baseUrl(): string {
  return (process.env.EVOLUTION_URL ?? '').replace(/\/$/, '');
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY ?? '' };
}

// Nome determinístico da instância do usuário (cuid é alfanumérico, seguro em URL)
export function instanceName(userId: string): string {
  return `adsgenius_${userId}`;
}

function webhookUrl(userId: string): string {
  const pub = (process.env.PUBLIC_URL ?? PUBLIC_URL_DEFAULT).replace(/\/$/, '');
  return `${pub}/api/whatsapp/webhook/${userId}`;
}

export interface ConnectResult {
  /** QR code como data-URI (imagem pronta p/ <img src>), quando disponível. */
  qrBase64: string | null;
  /** Código de pareamento por dígitos (alternativa ao QR), quando disponível. */
  pairingCode: string | null;
  /** Estado atual da conexão ("open" = conectado). */
  state: string;
}

// Estado da conexão: "open" (conectado) | "connecting" | "close" | "not_found"
export async function getConnectionState(userId: string): Promise<string> {
  const resp = await fetch(`${baseUrl()}/instance/connectionState/${instanceName(userId)}`, {
    headers: headers(),
  });
  if (resp.status === 404) return 'not_found';
  if (!resp.ok) throw new Error(`Evolution connectionState ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { instance?: { state?: string } };
  return data.instance?.state ?? 'close';
}

// Garante que a instância do usuário existe com o webhook certo e retorna o QR
// para parear. Idempotente: pode ser chamada de novo p/ renovar o QR expirado.
export async function connectInstance(userId: string): Promise<ConnectResult> {
  if (!evolutionConfigured()) {
    throw new Error('Evolution não configurada no servidor (EVOLUTION_URL/EVOLUTION_API_KEY)');
  }
  const name = instanceName(userId);
  const hook = webhookUrl(userId);

  // 1. Cria a instância (409/403 = já existe, segue em frente)
  const createResp = await fetch(`${baseUrl()}/instance/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: { url: hook, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] },
    }),
  });
  let createdQr: string | null = null;
  let createdPairing: string | null = null;
  if (createResp.ok) {
    const data = await createResp.json() as { qrcode?: { base64?: string; pairingCode?: string } };
    createdQr = data.qrcode?.base64 ?? null;
    createdPairing = data.qrcode?.pairingCode ?? null;
  } else if (![403, 409].includes(createResp.status)) {
    throw new Error(`Evolution create ${createResp.status}: ${await createResp.text()}`);
  }

  // 2. Garante o webhook (mesmo se a instância já existia com config antiga).
  //    Formato v2 ({ webhook: {...} }); se rejeitar, tenta o formato flat (v1.x).
  const hookBodyV2 = { webhook: { enabled: true, url: hook, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] } };
  const hookResp = await fetch(`${baseUrl()}/webhook/set/${name}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(hookBodyV2),
  });
  if (!hookResp.ok) {
    const flat = { enabled: true, url: hook, webhookByEvents: false, events: ['MESSAGES_UPSERT'] };
    const retry = await fetch(`${baseUrl()}/webhook/set/${name}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(flat),
    });
    if (!retry.ok) console.warn(`[evolution] webhook/set falhou (${hookResp.status}/${retry.status}) — instância ${name}`);
  }

  // 3. Estado atual; se já conectado, não precisa de QR
  const state = await getConnectionState(userId);
  if (state === 'open') return { qrBase64: null, pairingCode: null, state };

  if (createdQr) return { qrBase64: createdQr, pairingCode: createdPairing, state };

  // 4. Instância existia mas está desconectada → pede QR novo
  const connResp = await fetch(`${baseUrl()}/instance/connect/${name}`, { headers: headers() });
  if (!connResp.ok) throw new Error(`Evolution connect ${connResp.status}: ${await connResp.text()}`);
  const conn = await connResp.json() as { base64?: string; code?: string; pairingCode?: string };
  return {
    qrBase64: conn.base64 ?? null,
    pairingCode: conn.pairingCode ?? null,
    state,
  };
}

// Desconecta o WhatsApp do usuário (logout da sessão; a instância permanece).
export async function disconnectInstance(userId: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/instance/logout/${instanceName(userId)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Evolution logout ${resp.status}: ${await resp.text()}`);
  }
}
