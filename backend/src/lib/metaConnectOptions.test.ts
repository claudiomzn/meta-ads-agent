import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getMetaConnectOptions,
  isManualConnectEnabled,
  isMetaOAuthEnabled,
} from './metaConnectOptions.js';

const KEYS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'PUBLIC_URL',
  'META_OAUTH_ENABLED',
  'META_MANUAL_CONNECT_ENABLED',
] as const;

let saved: Record<string, string | undefined> = {};

function withCredentials() {
  process.env.META_APP_ID = 'app-id';
  process.env.META_APP_SECRET = 'app-secret';
  process.env.PUBLIC_URL = 'https://meta.example.com';
}

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('isMetaOAuthEnabled', () => {
  it('fica desligado sem as credenciais', () => {
    expect(isMetaOAuthEnabled()).toBe(false);
  });

  it('não liga só porque a variável diz que sim', () => {
    // Anunciar OAuth sem credencial faria o frontend mostrar um botão que só
    // sabe responder 503.
    process.env.META_OAUTH_ENABLED = 'true';
    expect(isMetaOAuthEnabled()).toBe(false);
  });

  it('liga quando há credenciais e nada em contrário', () => {
    withCredentials();
    expect(isMetaOAuthEnabled()).toBe(true);
  });

  it('permite desligar explicitamente mesmo com credenciais', () => {
    withCredentials();
    process.env.META_OAUTH_ENABLED = 'false';
    expect(isMetaOAuthEnabled()).toBe(false);
  });

  it('aceita as grafias usuais de booleano', () => {
    withCredentials();
    for (const off of ['0', 'no', 'off', 'FALSE']) {
      process.env.META_OAUTH_ENABLED = off;
      expect(isMetaOAuthEnabled()).toBe(false);
    }
    for (const on of ['1', 'yes', 'on', 'TRUE']) {
      process.env.META_OAUTH_ENABLED = on;
      expect(isMetaOAuthEnabled()).toBe(true);
    }
  });
});

describe('isManualConnectEnabled', () => {
  it('vem ligado por padrão', () => {
    expect(isManualConnectEnabled()).toBe(true);
  });

  it('pode ser desligado quando o OAuth está disponível', () => {
    withCredentials();
    process.env.META_MANUAL_CONNECT_ENABLED = 'false';
    expect(isManualConnectEnabled()).toBe(false);
  });

  it('ignora o desligamento se o OAuth não estiver disponível', () => {
    // Trava de segurança: desligar os dois deixaria todo cliente sem forma
    // nenhuma de conectar o Meta.
    process.env.META_MANUAL_CONNECT_ENABLED = 'false';
    expect(isMetaOAuthEnabled()).toBe(false);
    expect(isManualConnectEnabled()).toBe(true);
  });
});

describe('getMetaConnectOptions', () => {
  it('nunca devolve os dois caminhos fechados', () => {
    process.env.META_OAUTH_ENABLED = 'false';
    process.env.META_MANUAL_CONNECT_ENABLED = 'false';

    const options = getMetaConnectOptions();

    expect(options.oauth || options.manual).toBe(true);
  });

  it('descreve o estado de hoje: só manual, à espera do App Review', () => {
    const options = getMetaConnectOptions();
    expect(options).toEqual({ oauth: false, manual: true });
  });
});
