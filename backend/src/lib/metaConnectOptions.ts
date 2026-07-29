// Quais caminhos de conexão com o Meta estão abertos.
//
// O OAuth próprio só funciona de fato quando a Meta aprova o app (App Review
// dos escopos `ads_management` / `business_management`) e as credenciais estão
// configuradas no ambiente. Até lá, a conexão manual — o cliente cola o próprio
// token — é o único caminho que funciona.
//
// Em vez de decidir isso no código e precisar de deploy a cada mudança, as duas
// vias são controladas por ambiente. Assim, no dia em que a Meta aprovar, é só
// virar as variáveis no Render.

function readFlag(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return null;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return null;
}

function hasOAuthCredentials(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.PUBLIC_URL);
}

/**
 * OAuth disponível. `META_OAUTH_ENABLED` manda quando definida; sem ela, vale a
 * presença das credenciais — o que evita anunciar ao frontend um botão que só
 * responderia 503. Ligar por variável sem ter credencial não habilita nada.
 */
export function isMetaOAuthEnabled(): boolean {
  if (!hasOAuthCredentials()) return false;
  return readFlag('META_OAUTH_ENABLED') ?? true;
}

/**
 * Conexão manual disponível. Padrão ligado; desligue com
 * `META_MANUAL_CONNECT_ENABLED=false` depois que o OAuth estiver aprovado.
 *
 * Trava de segurança: se o OAuth não está disponível, o manual permanece
 * ligado mesmo que a variável diga o contrário. Desligar os dois deixaria todos
 * os clientes sem forma alguma de conectar o Meta, e essa é uma configuração
 * que ninguém quer de verdade.
 */
export function isManualConnectEnabled(): boolean {
  const flag = readFlag('META_MANUAL_CONNECT_ENABLED') ?? true;
  if (!flag && !isMetaOAuthEnabled()) return true;
  return flag;
}

export interface MetaConnectOptions {
  oauth: boolean;
  manual: boolean;
}

export function getMetaConnectOptions(): MetaConnectOptions {
  return { oauth: isMetaOAuthEnabled(), manual: isManualConnectEnabled() };
}
