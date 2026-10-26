import { normalizeTenantPath, tenantIdFromToken } from './tenant-context';
import { clearAccessToken, getAccessToken, setAccessToken } from '../auth/token-store';
import type { AuthDomain } from '../auth/token-store';
import { readApiJson } from './response';

/** API 客户端（统一响应 {code,message,data} 解析，前后端约定 §1） */
// 未显式配置时使用同源路径：开发环境由 Vite 代理，生产环境由反向代理承接。
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const URL_BASE = BASE || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 无感刷新（约定 §5）：40101/40102 → 调 refresh 换新 Access → 重试原请求（单飞，避免并发重复刷新）
const refreshing: Partial<Record<AuthDomain, Promise<string | null>>> = {};

/** 租户页面构造请求时使用的占位值；真正租户 ID 始终由当前登录令牌覆盖。 */
export const CURRENT_TENANT_ID = '__current_tenant__';

async function refreshToken(domain: AuthDomain): Promise<string | null> {
  if (!refreshing[domain]) {
    refreshing[domain] = (async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/platform/auth/refresh?domain=${domain}`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(10000) });
        const body = await readApiJson<ApiResponse<{ access_token: string }> | null>(res);
        if (!res.ok || !body || body.code !== 0 || !body.data?.access_token) return null;
        const token = body.data.access_token;
        setAccessToken(domain, token);
        return token;
      } finally {
        delete refreshing[domain];
      }
    })();
  }
  return refreshing[domain]!;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  // 两套控制台可在同一浏览器并存：按 API 域选取对应令牌，避免平台令牌覆盖租户请求。
  const domain = path.startsWith('/api/v1/tenant/') ? 'tenant' : 'platform';
  let token = getAccessToken(domain);
  const doFetch = async (retried = false): Promise<T> => {
    let requestPath = path;
    let requestBody = options?.body;
    if (domain === 'tenant') {
      const tenantId = tenantIdFromToken(token);
      if (tenantId) {
        requestPath = normalizeTenantPath(path, token, URL_BASE);
        if (typeof requestBody === 'string') {
          try {
            const json = JSON.parse(requestBody) as Record<string, unknown>;
            if ('tenantId' in json) { json.tenantId = tenantId; requestBody = JSON.stringify(json); }
          } catch { /* 非 JSON 请求体保持原样 */ }
        }
      }
    }
    const res = await fetch(`${BASE}${requestPath}`, {
      ...options,
      credentials: 'include', // 携带 httpOnly refresh_token Cookie
      headers: { ...(requestBody instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options?.headers ?? {}) },
      body: requestBody,
    });
    const body = await readApiJson<ApiResponse<T> | null>(res);
    // 业务错误仅在存在 code 且非 0 时判定（201 创建等裸对象响应兼容）
    if (!res.ok || (body && body.code !== undefined && body.code !== 0)) {
      // 认证失效（40101/40102）→ 无感刷新后重试一次（排除 refresh 自身避免死循环）
      const authFailed = body && (body.code === 40101 || body.code === 40102);
      if (authFailed && !retried && !path.includes('/auth/refresh')) {
        const newToken = await refreshToken(domain);
        if (newToken) {
          token = newToken;
          return doFetch(true);
        }
      }
      throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    // 部分接口直接返回数组/对象（非三段式包装时兼容）
    return (body && 'data' in body ? body.data : body) as T;
  };
  return doFetch();
}

/** 认证文件下载；浏览器直链无法携带 Authorization，因此统一转为 Blob 下载。 */
export async function downloadApi(path: string, filename: string): Promise<void> {
  let token = getAccessToken('tenant');
  const fetchBlob = () => fetch(`${BASE}${normalizeTenantPath(path, token, URL_BASE)}`, {
    credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let response = await fetchBlob();
  if (response.status === 401) {
    const refreshed = await refreshToken('tenant');
    if (refreshed) { token = refreshed; response = await fetchBlob(); }
  }
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(href);
}

/** 页面刷新时，仅通过 httpOnly Refresh Cookie 恢复内存会话。 */
export function restoreSession(domain: AuthDomain): Promise<string | null> {
  return getAccessToken(domain) ? Promise.resolve(getAccessToken(domain)) : refreshToken(domain);
}

/** 服务端清除 Refresh Cookie，并无条件清空当前页面的 Access Token。 */
export async function logoutSession(domain: AuthDomain): Promise<void> {
  try {
    await fetch(`${BASE}/api/v1/platform/auth/logout?domain=${domain}`, { method: 'POST', credentials: 'include' });
  } finally {
    clearAccessToken(domain);
  }
}

export interface Tenant {
  id: string;
  name: string;
  planId: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING_ACTIVATION' | 'DELETED';
  adminEmail: string;
  cycleStartAt: string;
  isTrial: boolean;
  createdAt: string;
  quotaAlertLevel?: 'REMINDER' | 'STRONG';
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  robotLimit: number;
  userLimit: number;
  kbLimit: number;
  aiQuota: number;
  fileSizeLimitMb: number;
  channelLimit: number;
  adminWindowLimit: number;
  isActive: boolean;
  isFeatured: boolean;
}

export interface DifyApp {
  id: string;
  name: string;
  mode: string;
}
