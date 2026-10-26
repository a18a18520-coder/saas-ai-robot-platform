import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const MASKED_SECRET = '••••••••';
const PREFIX = 'enc:v1:';
const AAD = Buffer.from('saas-ai-robot-platform:secret:v1');

@Injectable()
export class SecretsService {
  private readonly keys: Buffer[];

  constructor(private readonly config: ConfigService) {
    const current = this.config.get<string>('APP_ENCRYPTION_KEY');
    const previous = this.config.get<string>('APP_ENCRYPTION_KEY_PREVIOUS');
    if (!current) throw new Error('缺少 APP_ENCRYPTION_KEY（开发与生产环境均需显式配置）');
    this.keys = [this.parseKey(current)];
    if (previous) this.keys.push(this.parseKey(previous));
  }

  isEncrypted(value?: string): boolean {
    return !!value?.startsWith(PREFIX);
  }

  encrypt(value?: string): string | undefined {
    if (value === undefined || value === null || value === '') return value;
    if (this.isEncrypted(value)) return value;
    return this.encryptPlaintext(value);
  }

  decrypt(value?: string): string | undefined {
    if (value === undefined || value === null || value === '' || !this.isEncrypted(value)) return value;
    const parts = value.split(':');
    if (parts.length !== 5) throw new Error('密文格式无效');
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const encrypted = Buffer.from(parts[4], 'base64url');
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      } catch {
        // Try the previous rotation key, if configured.
      }
    }
    throw new Error('密文无法解密，请检查 APP_ENCRYPTION_KEY 或上一版密钥');
  }

  /** Re-encrypt with the current key after decrypting with current/previous/legacy plaintext. */
  rotate(value?: string): string | undefined {
    if (value === undefined || value === null || value === '') return value;
    return this.encryptPlaintext(this.decrypt(value)!);
  }

  encryptRecord(record: Record<string, string> = {}, fields: readonly string[]): Record<string, string> {
    const output = { ...record };
    for (const field of fields) {
      if (output[field] && output[field] !== MASKED_SECRET) output[field] = this.encrypt(output[field])!;
    }
    return output;
  }

  decryptRecord(record: Record<string, string> = {}, fields: readonly string[]): Record<string, string> {
    const output = { ...record };
    for (const field of fields) if (output[field]) output[field] = this.decrypt(output[field])!;
    return output;
  }

  redactRecord(record: Record<string, string> = {}, fields: readonly string[]): Record<string, string> {
    const output = { ...record };
    for (const field of fields) if (output[field]) output[field] = MASKED_SECRET;
    return output;
  }

  mergeEncryptedRecord(
    stored: Record<string, string> = {},
    incoming: Record<string, string> = {},
    secretFields: readonly string[],
  ): Record<string, string> {
    const output = { ...stored };
    for (const [field, value] of Object.entries(incoming)) {
      if (secretFields.includes(field)) {
        if (value === MASKED_SECRET) continue;
        output[field] = value ? this.encrypt(value)! : '';
      } else {
        output[field] = value;
      }
    }
    return output;
  }

  private parseKey(value: string): Buffer {
    const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制字符串');
    return key;
  }

  private encryptPlaintext(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys[0], iv);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  }
}
