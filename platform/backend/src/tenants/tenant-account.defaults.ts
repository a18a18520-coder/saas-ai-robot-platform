import { randomBytes } from 'crypto';

export const TENANT_WINDOW_PERMISSIONS = [
  'dashboard',
  'notifications',
  'robots',
  'channels',
  'groups',
  'messages',
  'broadcast',
  'follow-ups',
  'sessions',
  'users',
  'roles',
  'knowledge',
  'tools',
  'audit',
  'logs',
  'settings',
] as const;

export type TenantWindowPermission = (typeof TENANT_WINDOW_PERMISSIONS)[number];

export const BUILTIN_TENANT_ROLE_WINDOWS: Record<
  string,
  readonly TenantWindowPermission[]
> = {
  游客: [],
  用户: ['dashboard', 'notifications'],
  客服: [
    'dashboard',
    'notifications',
    'groups',
    'messages',
    'follow-ups',
    'sessions',
    'users',
  ],
  运营: [
    'dashboard',
    'notifications',
    'robots',
    'channels',
    'groups',
    'messages',
    'broadcast',
    'follow-ups',
    'sessions',
    'users',
    'knowledge',
    'tools',
    'audit',
    'logs',
  ],
  管理员: TENANT_WINDOW_PERMISSIONS,
};

export const TENANT_ADMIN_WINDOWS = [...TENANT_WINDOW_PERMISSIONS];

/** 每个租户生成独立的高熵临时密码，固定前后缀保证字母和数字强度。 */
export function generateTenantInitialPassword(): string {
  return `Tn${randomBytes(9).toString('base64url')}7`;
}

export function isStrongTenantPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 10 &&
    value.length <= 128 &&
    /[a-z]/i.test(value) &&
    /\d/.test(value)
  );
}
