import { OidcService } from './oidc.service';

describe('OidcService', () => {
  const values: Record<string, string> = {
    OIDC_AUTHORIZATION_URL: 'https://id.example.com/authorize',
    OIDC_TOKEN_URL: 'https://id.example.com/token',
    OIDC_USERINFO_URL: 'https://id.example.com/userinfo',
    OIDC_CLIENT_ID: 'client',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'https://app.example.com/api/v1/platform/auth/tenant/sso/callback',
    PUBLIC_APP_URL: 'https://app.example.com',
  };
  const config = { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };

  beforeEach(() => jest.restoreAllMocks());

  it('生成带 state 与 PKCE 的授权地址', () => {
    const url = new URL(new OidcService(config as any).createAuthorizationUrl());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('交换授权码并以 UserInfo 邮箱作为登录账号', async () => {
    const service = new OidcService(config as any);
    const url = new URL(service.createAuthorizationUrl());
    const state = url.searchParams.get('state')!;
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'Admin@Example.COM', email_verified: true, sub: 'u1' }) } as Response);
    await expect(service.exchange('code', state)).resolves.toMatchObject({ email: 'admin@example.com', subject: 'u1' });
    await expect(service.exchange('code', state)).rejects.toThrow('SSO 登录状态无效或已过期');
  });

  it('默认拒绝身份提供方未验证的邮箱', async () => {
    const service = new OidcService(config as any);
    const state = new URL(service.createAuthorizationUrl()).searchParams.get('state')!;
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'user@example.com', email_verified: false }) } as Response);
    await expect(service.exchange('code', state)).rejects.toThrow('邮箱尚未通过');
  });
});
