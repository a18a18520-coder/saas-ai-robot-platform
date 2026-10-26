import type { AccessTokenPayload } from './token-store.js';

export const PLATFORM_PATH_PERMISSION: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/notifications': 'notifications',
  '/tenants': 'tenants',
  '/plans': 'plans',
  '/payments': 'payments',
  '/dify': 'dify',
  '/models': 'settings',
  '/audit': 'audit',
  '/stats': 'stats',
  '/tools': 'tools',
  '/filter': 'filter',
  '/settings': 'settings',
  '/accounts': 'accounts',
};

export function canAccessPlatformPath(
  path: string,
  payload: AccessTokenPayload,
): boolean {
  if (payload.domain !== 'platform') return false;
  if (payload.role === 'SUPER_ADMIN') return true;
  const route = Object.keys(PLATFORM_PATH_PERMISSION)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!route || route === '/accounts') return false;
  return (
    payload.permissions?.includes(PLATFORM_PATH_PERMISSION[route]) ?? false
  );
}

export function firstPlatformPath(payload: AccessTokenPayload): string | null {
  const routes = [
    '/dashboard',
    '/notifications',
    '/tenants',
    '/plans',
    '/payments',
    '/dify',
    '/audit',
    '/stats',
    '/tools',
    '/filter',
    '/settings',
  ];
  return routes.find((path) => canAccessPlatformPath(path, payload)) ?? null;
}
