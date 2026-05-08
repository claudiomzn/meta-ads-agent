import CryptoJS from 'crypto-js';

const KEY = process.env.ENCRYPTION_KEY!;

if (!KEY || KEY.length < 16) {
  throw new Error('ENCRYPTION_KEY deve ter pelo menos 16 caracteres');
}

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, KEY).toString();
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
