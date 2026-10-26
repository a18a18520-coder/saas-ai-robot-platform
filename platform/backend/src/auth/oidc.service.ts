import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';

interface PendingAuthorization {
  verifier: string;
  expiresAt: number;
}

/** 标准 OIDC Authorization Code + PKCE。用户身份以 UserInfo 返回的 email 为准。 */
@Injectable()
export class OidcService {
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return ['OIDC_AUTHORIZATION_URL', 'OIDC_TOKEN_URL', 'OIDC_USERINFO_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'PUBLIC_APP_URL']
      .every((key) => !!this.config.get<string>(key));
  }

  createAuthorizationUrl(): string {
    if (!this.isEnabled()) throw new ServiceUnavailableException({ code: 50301, message: '企业 SSO 尚未配置', data: null });
    this.purgeExpired();
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60_000 });

    const url = new URL(this.required('OIDC_AUTHORIZATION_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.required('OIDC_CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.required('OIDC_REDIRECT_URI'));
    url.searchParams.set('scope', this.config.get('OIDC_SCOPE', 'openid email profile'));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchange(code: string, state: string): Promise<{ email: string; subject?: string; name?: string }> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!code || !pending || pending.expiresAt < Date.now()) {
      throw new UnauthorizedException({ code: 40101, message: 'SSO 登录状态无效或已过期', data: null });
    }

    const credentials = Buffer.from(`${this.required('OIDC_CLIENT_ID')}:${this.required('OIDC_CLIENT_SECRET')}`).toString('base64');
    const tokenResponse = await fetch(this.required('OIDC_TOKEN_URL'), {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: this.required('OIDC_REDIRECT_URI'),
        code_verifier: pending.verifier,
      }),
    });
    const token = await tokenResponse.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
    if (!tokenResponse.ok || !token?.access_token) {
      throw new UnauthorizedException({ code: 40101, message: token?.error_description ?? 'SSO 授权码交换失败', data: null });
    }

    const profileResponse = await fetch(this.required('OIDC_USERINFO_URL'), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = await profileResponse.json().catch(() => null) as { email?: string; email_verified?: boolean; sub?: string; name?: string } | null;
    if (!profileResponse.ok || !profile?.email) {
      throw new UnauthorizedException({ code: 40101, message: 'SSO 未返回可验证邮箱', data: null });
    }
    if (this.config.get('OIDC_REQUIRE_EMAIL_VERIFIED', 'true') === 'true' && profile.email_verified !== true) {
      throw new UnauthorizedException({ code: 40101, message: 'SSO 邮箱尚未通过身份提供方验证', data: null });
    }
    return { email: profile.email.trim().toLowerCase(), subject: profile.sub, name: profile.name };
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new ServiceUnavailableException({ code: 50301, message: `缺少 ${key} 配置`, data: null });
    return value;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [state, item] of this.pending) if (item.expiresAt < now) this.pending.delete(state);
  }
}
