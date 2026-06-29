import prisma from '../lib/prisma.js';
import axios from 'axios';

import { decrypt } from './crypto.service.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export interface PixelStatus {
  connected: boolean;
  pixelId: string | null;
  pixelName: string | null;
}

export class PixelService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private async getToken(): Promise<string> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn) throw new Error('Conta Meta não conectada.');

    // Pipeboard/Zapier não têm token Meta direto — usa o META_ACCESS_TOKEN do .env
    if (conn.mcpProvider === 'pipeboard' || conn.mcpProvider === 'zapier') {
      const envToken = process.env.META_ACCESS_TOKEN;
      if (!envToken) throw new Error('META_ACCESS_TOKEN não configurado.');
      return envToken;
    }

    return decrypt(conn.metaAccessToken);
  }

  // Resolve o act_XXX real da conta — adAccountIds salvo no banco é só um label.
  // IMPORTANTE: usa this.getToken() (já trata pipeboard/zapier corretamente)
  // direto na Graph API — NÃO usar o MCP aqui. O MCP autentica com
  // conn.metaAccessToken, que para contas pipeboard/zapier não é um token
  // Meta válido (causava "invalid_token" ao criar o Pixel).
  private async getAdAccountId(): Promise<string> {
    const token = await this.getToken();
    const res = await axios.get(`${GRAPH}/me/adaccounts`, {
      params: { fields: 'id,name', access_token: token },
    });
    const accounts = res.data?.data ?? [];
    if (!accounts.length) throw new Error('Nenhuma conta de anúncio vinculada.');
    // TODO multi-tenant: se o token for compartilhado entre vários clientes
    // (System User), accounts[0] pode não ser a conta certa deste usuário —
    // hoje só há uma conta Meta real conectada, então é seguro. Revisar
    // quando houver múltiplos clientes pipeboard/zapier simultâneos.
    return accounts[0].id;
  }

  // Retorna o status atual do Pixel (conectado ou não)
  async getStatus(): Promise<PixelStatus> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn) throw new Error('Conta Meta não conectada.');

    if (conn.metaPixelId) {
      const token = await this.getToken();
      try {
        const res = await axios.get(`${GRAPH}/${conn.metaPixelId}`, {
          params: { fields: 'id,name', access_token: token },
        });
        return { connected: true, pixelId: res.data.id, pixelName: res.data.name };
      } catch {
        // Pixel salvo não existe mais (foi removido no Meta) — limpa e segue como desconectado
        await prisma.mCPConnection.update({ where: { userId: this.userId }, data: { metaPixelId: null } });
      }
    }

    return { connected: false, pixelId: null, pixelName: null };
  }

  // Busca um Pixel existente na conta de anúncio ou cria um novo
  async createOrGetPixel(): Promise<PixelStatus> {
    const token = await this.getToken();
    const adAccountId = await this.getAdAccountId();

    // Verifica se já existe algum pixel na conta
    const existing = await axios.get(`${GRAPH}/${adAccountId}/adspixels`, {
      params: { fields: 'id,name', access_token: token },
    });

    let pixel = existing.data?.data?.[0];

    if (!pixel) {
      const created = await axios.post(`${GRAPH}/${adAccountId}/adspixels`, null, {
        params: { name: 'AdsGenius Pixel', access_token: token },
      });
      pixel = { id: created.data.id, name: 'AdsGenius Pixel' };
    }

    await prisma.mCPConnection.update({
      where: { userId: this.userId },
      data: { metaPixelId: pixel.id },
    });

    return { connected: true, pixelId: pixel.id, pixelName: pixel.name ?? null };
  }
}
