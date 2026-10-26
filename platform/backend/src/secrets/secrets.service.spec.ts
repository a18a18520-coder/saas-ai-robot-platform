import { ConfigService } from '@nestjs/config';
import { MASKED_SECRET, SecretsService } from './secrets.service';

describe('SecretsService', () => {
  const key = Buffer.alloc(32, 9).toString('base64');
  const service = new SecretsService(new ConfigService({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: key }));

  it('encrypts with authenticated encryption and round-trips', () => {
    const encrypted = service.encrypt('top-secret')!;
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('top-secret');
    expect(service.decrypt(encrypted)).toBe('top-secret');
  });

  it('rejects modified ciphertext', () => {
    const encrypted = service.encrypt('top-secret')!;
    const parts = encrypted.split(':');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    expect(() => service.decrypt(parts.join(':'))).toThrow(/无法解密/);
  });

  it('keeps masked values during partial updates and redacts responses', () => {
    const stored = service.encryptRecord({ secret: 'old', domain: 'example.com' }, ['secret']);
    const merged = service.mergeEncryptedRecord(stored, { secret: MASKED_SECRET, domain: 'new.example.com' }, ['secret']);
    expect(service.decryptRecord(merged, ['secret'])).toEqual({ secret: 'old', domain: 'new.example.com' });
    expect(service.redactRecord(merged, ['secret']).secret).toBe(MASKED_SECRET);
  });

  it('rotates ciphertext with a new current key while accepting the previous key', () => {
    const old = new SecretsService(new ConfigService({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') }));
    const next = new SecretsService(new ConfigService({
      NODE_ENV: 'test', APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), APP_ENCRYPTION_KEY_PREVIOUS: Buffer.alloc(32, 8).toString('base64'),
    }));
    const before = old.encrypt('rotate-me')!;
    const after = next.rotate(before)!;
    expect(after).not.toBe(before);
    expect(next.decrypt(after)).toBe('rotate-me');
    expect(() => old.decrypt(after)).toThrow();
  });
});
