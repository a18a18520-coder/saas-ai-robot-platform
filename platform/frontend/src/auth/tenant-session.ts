import { getAccessPayload } from './token-store.js';

export interface TenantSession {
  sub: string;
  tenantId: string;
  role: 'TENANT_ADMIN' | 'TENANT_OP';
  roleId?: string;
  roleName?: string;
  windows?: string[];
  mustChangePassword?: boolean;
}

const WINDOW_BY_ROUTE: Record<string, string> = {
  dashboard: 'dashboard', notifications: 'notifications', robots: 'robots', channels: 'channels', tools: 'tools',
  groups: 'groups', messages: 'messages', collector: 'messages', broadcast: 'broadcast', 'follow-ups': 'follow-ups', sessions: 'sessions',
  wiki: 'knowledge', evaluations: 'robots',
  audit: 'audit', logs: 'logs', knowledge: 'knowledge', users: 'users', roles: 'roles', settings: 'settings',
};

const TENANT_PATH_ORDER = [
  '/t/dashboard', '/t/notifications', '/t/robots', '/t/channels', '/t/groups', '/t/messages', '/t/broadcast',
  '/t/follow-ups', '/t/sessions', '/t/users', '/t/roles', '/t/knowledge', '/t/tools', '/t/audit', '/t/logs', '/t/settings',
] as const;

export function getTenantSession(): TenantSession | null {
  const payload = getAccessPayload('tenant');
  // 过期由 API 层触发 refresh cookie 轮换；此处保留上下文，避免提前跳回登录页。
  if (!payload?.tenantId || (payload.role !== 'TENANT_ADMIN' && payload.role !== 'TENANT_OP')) return null;
  return {
    sub: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role,
    roleId: payload.roleId,
    roleName: payload.roleName,
    windows: payload.windows,
    mustChangePassword: payload.mustChangePassword,
  };
}

export function canAccessTenantPath(pathname: string, session = getTenantSession()): boolean {
  if (!session) return false;
  const resource = pathname.replace(/^\/t\/?/, '').split('/')[0] || 'dashboard';
  const required = WINDOW_BY_ROUTE[resource];
  return !required || !session.windows || session.windows.includes(required);
}

export function windowForTenantPath(pathname: string): string | undefined {
  return WINDOW_BY_ROUTE[pathname.replace(/^\/t\/?/, '').split('/')[0] || 'dashboard'];
}

export function firstTenantPath(session = getTenantSession()): string | null {
  return TENANT_PATH_ORDER.find((path) => canAccessTenantPath(path, session)) ?? null;
}
