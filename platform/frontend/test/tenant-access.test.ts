import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessTenantPath,
  firstTenantPath,
} from '../src/auth/tenant-session.js';

const session = {
  sub: 'account-1',
  tenantId: 'tenant-1',
  role: 'TENANT_OP' as const,
  roleId: 'role-1',
  roleName: '客服主管',
  windows: ['messages', 'users'],
};

test('租户管理账号只可进入绑定角色授权的功能', () => {
  assert.equal(canAccessTenantPath('/t/messages', session), true);
  assert.equal(canAccessTenantPath('/t/users', session), true);
  assert.equal(canAccessTenantPath('/t/settings', session), false);
  assert.equal(canAccessTenantPath('/t/roles', session), false);
  assert.equal(firstTenantPath(session), '/t/messages');
});

test('没有后台功能权限的角色不获得默认入口', () => {
  assert.equal(firstTenantPath({ ...session, windows: [] }), null);
});
