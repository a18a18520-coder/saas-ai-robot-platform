import { randomBytes, timingSafeEqual } from 'crypto';

const SITE_KEY_BYTES = 24;

/** Web 渠道使用不可枚举的公开站点键，避免直接暴露租户和机器人标识。 */
export function ensureWebSiteKey(config: Record<string, string>): Record<string, string> {
  if (config.site_key?.trim()) return config;
  return { ...config, site_key: randomBytes(SITE_KEY_BYTES).toString('base64url') };
}

export function parseWebOrigins(value: string): string[] {
  const entries = String(value ?? '').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
  if (!entries.length) throw new Error('Web 渠道缺少允许访问域名');
  return [...new Set(entries.map(normalizeWebOrigin))];
}

export function isWebOriginAllowed(origin: string, configured: string): boolean {
  try {
    return parseWebOrigins(configured).includes(normalizeWebOrigin(origin));
  } catch {
    return false;
  }
}

export function siteKeysEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(String(actual ?? ''));
  const right = Buffer.from(String(expected ?? ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function normalizeWebOrigin(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Web 渠道域名格式无效: ${value}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`Web 渠道域名必须使用 HTTPS: ${value}`);
  }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(`Web 渠道域名只能填写站点来源，不可包含路径或参数: ${value}`);
  }
  return url.origin;
}
