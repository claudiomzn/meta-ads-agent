import prisma from '../lib/prisma.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { decrypt } from './crypto.service.js';
import { resolveUserAdAccountId } from '../lib/adAccount.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export interface UploadedMedia {
  type: 'image' | 'video';
  hash?: string;       // Para imagens — usado na API do Meta
  videoId?: string;    // Para vídeos
  url: string;         // URL local (preview)
  name: string;
}

export class MediaService {
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

  // Antes lia conn.adAccountIds e devolvia ids[0] CRU. O frontend grava o id
  // sem o prefixo (MetaConnect faz `.replace("act_", "")`), então a URL saía
  // como `/1234567890/adimages` — os endpoints de ad account da Graph API
  // exigem `act_<id>`, e o upload falhava. lib/adAccount.ts normaliza o
  // prefixo e confirma a conta contra as que o token realmente acessa.
  private async getAdAccountId(): Promise<string> {
    const token = await this.getToken();
    return resolveUserAdAccountId(this.userId, token);
  }

  // Upload de imagem para Meta Ad Images API
  async uploadImage(filePath: string, fileName: string): Promise<UploadedMedia> {
    const token = await this.getToken();
    const adAccountId = await this.getAdAccountId();

    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');

    const formData = new FormData();
    formData.append('bytes', base64);
    formData.append('name', fileName);
    formData.append('access_token', token);

    const res = await axios.post(
      `${GRAPH}/${adAccountId}/adimages`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );

    const images = res.data.images;
    const imageKey = Object.keys(images)[0];
    const imageData = images[imageKey];

    return {
      type: 'image',
      hash: imageData.hash,
      url: imageData.url,
      name: fileName,
    };
  }

  // Upload de vídeo para Meta Ad Videos API
  async uploadVideo(filePath: string, fileName: string): Promise<UploadedMedia> {
    const token = await this.getToken();
    const adAccountId = await this.getAdAccountId();

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(fileName).toLowerCase().replace('.', '');

    const FormDataNode = (await import('form-data')).default;
    const form = new FormDataNode();
    form.append('source', fileBuffer, { filename: fileName, contentType: `video/${ext}` });
    form.append('title', fileName);
    form.append('access_token', token);

    const res = await axios.post(
      `${GRAPH}/${adAccountId}/advideos`,
      form,
      { headers: form.getHeaders() },
    );

    return {
      type: 'video',
      videoId: res.data.id,
      url: '',
      name: fileName,
    };
  }

}
