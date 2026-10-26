import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAccessToken, getAccessPayload, getAccessToken, setAccessToken } from '../src/auth/token-store.js';

function token(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('keeps access tokens in process memory and validates their auth domain', () => {
  setAccessToken('tenant', token({ sub: 'account-1', domain: 'tenant', tenantId: 'tenant-1', role: 'TENANT_ADMIN', mustChangePassword: true }));
  assert.equal(getAccessPayload('tenant')?.tenantId, 'tenant-1');
  assert.equal(getAccessPayload('tenant')?.mustChangePassword, true);
  assert.equal(getAccessPayload('platform'), null);
  clearAccessToken('tenant');
  assert.equal(getAccessToken('tenant'), '');
});

test('rejects malformed or incomplete access token payloads', () => {
  setAccessToken('platform', token({ domain: 'platform', role: 'SUPER_ADMIN' }));
  assert.equal(getAccessPayload('platform'), null);
  setAccessToken('platform', 'not-a-token');
  assert.equal(getAccessPayload('platform'), null);
  clearAccessToken('platform');
});
