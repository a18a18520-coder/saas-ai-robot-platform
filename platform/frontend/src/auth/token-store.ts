export type AuthDomain = 'platform' | 'tenant';

export interface AccessTokenPayload {
  sub: string;
  domain: AuthDomain;
  role: 'SUPER_ADMIN' | 'PLATFORM_OP' | 'TENANT_ADMIN' | 'TENANT_OP';
  tenantId?: string;
  roleId?: string;
  windows?: string[];
  mustChangePassword?: boolean;
  permissions?: string[];
  name?: string;
  roleName?: string;
  exp?: number;
}

const tokens: Record<AuthDomain, string> = { platform: '', tenant: '' };

/**
 * Access Token 只保留在当前页面内存中。刷新后使用 httpOnly Cookie 恢复会话，
 * 避免长期凭据落入 localStorage 后被持久窃取。
 */
export function getAccessToken(domain: AuthDomain): string {
  return tokens[domain];
}

export function setAccessToken(domain: AuthDomain, token: string): void {
  tokens[domain] = token;
  removeLegacyToken(domain);
}

export function clearAccessToken(domain: AuthDomain): void {
  tokens[domain] = '';
  removeLegacyToken(domain);
}

export function clearLegacyTokens(): void {
  removeLegacyToken('platform');
  removeLegacyToken('tenant');
}

export function getAccessPayload(
  domain: AuthDomain,
): AccessTokenPayload | null {
  const token = getAccessToken(domain);
  if (!token) return null;
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(
      decodeURIComponent(
        Array.from(
          atob(base64),
          (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
        ).join(''),
      ),
    ) as AccessTokenPayload;
    if (!payload.sub || payload.domain !== domain || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

function removeLegacyToken(domain: AuthDomain): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${domain}_token`);
    window.sessionStorage.removeItem(`${domain}_token`);
  } catch {
    // 存储被浏览器策略禁用时，内存会话仍可正常工作。
  }
}
