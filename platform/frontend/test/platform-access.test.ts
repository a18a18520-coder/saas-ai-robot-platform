import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessPlatformPath,
  firstPlatformPath,
} from '../src/auth/platform-access.js';

test('超级管理员可访问账号角色管理', () => {
  const session = {
    sub: 'admin',
    domain: 'platform' as const,
    role: 'SUPER_ADMIN' as const,
  };
  assert.equal(canAccessPlatformPath('/accounts', session), true);
});

test('普通平台账号按角色权限显示首页并拒绝越权路由', () => {
  const session = {
    sub: 'operator',
    domain: 'platform' as const,
    role: 'PLATFORM_OP' as const,
    permissions: ['payments'],
  };
  assert.equal(canAccessPlatformPath('/payments', session), true);
  assert.equal(canAccessPlatformPath('/settings', session), false);
  assert.equal(canAccessPlatformPath('/accounts', session), false);
  assert.equal(firstPlatformPath(session), '/payments');
});
