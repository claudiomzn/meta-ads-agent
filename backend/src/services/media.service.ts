import prisma from '../lib/prisma.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { decrypt } from './crypto.service.js';

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
    const decrypted = decrypt(conn.metaAccessToken);
    if (decrypted.startsWith('pipeboard:') || decrypted.startsWith('zapier')) {
      const envToken = process.env.META_ACCESS_TOKEN;
      if (!envToken) throw new Error('META_ACCESS_TOKEN não configurado.');
      return envToken;
    }
    return decrypted;
  }

  private async getAdAccountId(): Promise<string> {
    const conn = await prisma.mCPConnection.findUnique({ where: { userId: this.userId } });
    if (!conn || !conn.adAccountIds?.length) throw new Error('Nenhuma conta de anúncio vinculada.');
    // adAccountIds é armazenado como JSON string — ex: '["act_123","act_456"]'
    const ids: string[] = JSON.parse(conn.adAccountIds);
    if (!ids.length) throw new Error('Nenhuma conta de anúncio vinculada.');
    return ids[0];
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
