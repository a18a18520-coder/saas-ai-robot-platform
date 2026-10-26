import { buildCorsOptions } from './cors';
import { validateEnvironment } from './environment';

describe('production environment validation', () => {
  const valid = {
    NODE_ENV: 'production',
    DB_HOST: 'db',
    DB_USER: 'app',
    DB_PASS: 'strong-password',
    DB_NAME: 'robot',
    DB_SYNC: 'false',
    JWT_SECRET: 'j'.repeat(32),
    CORS_ORIGINS: 'https://console.example.com',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PLATFORM_SUPER_ADMIN_EMAIL: 'admin@example.com',
    PLATFORM_SUPER_ADMIN_PASSWORD: 'AdminSecure2026',
  };

  it('accepts an explicit hardened production configuration', () => {
    expect(validateEnvironment(valid).DB_SYNC).toBe('false');
  });

  it('rejects automatic schema sync and wildcard CORS in production', () => {
    expect(() =>
      validateEnvironment({ ...valid, DB_SYNC: 'true', CORS_ORIGINS: '*' }),
    ).toThrow(/DB_SYNC=true/);
  });

  it('rejects short JWT and invalid encryption keys', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        JWT_SECRET: 'short',
        APP_ENCRYPTION_KEY: 'short',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('requires an explicit encryption key in development too', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'development' })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it('rejects unsafe reverse-proxy hop counts', () => {
    expect(() =>
      validateEnvironment({
        APP_ENCRYPTION_KEY: valid.APP_ENCRYPTION_KEY,
        TRUST_PROXY_HOPS: '-1',
      }),
    ).toThrow(/TRUST_PROXY_HOPS/);
    expect(
      validateEnvironment({
        APP_ENCRYPTION_KEY: valid.APP_ENCRYPTION_KEY,
        TRUST_PROXY_HOPS: '1',
      }).TRUST_PROXY_HOPS,
    ).toBe(1);
  });
});

describe('CORS allowlist', () => {
  it('allows configured origins and rejects unknown origins', () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://console.example.com',
    });
    const origin = options.origin as (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => void;
    origin('https://console.example.com', (error, allowed) => {
      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });
    origin('https://evil.example.com', (error, allowed) => {
      expect(error).toBeInstanceOf(Error);
      expect(allowed).toBe(false);
    });
  });

  it('开发环境允许 IPv6 回环地址打开控制台', () => {
    const options = buildCorsOptions({ NODE_ENV: 'development' });
    const origin = options.origin as (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => void;
    origin('http://[::1]:5173', (error, allowed) => {
      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });
  });
});
