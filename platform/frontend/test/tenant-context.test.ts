import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTenantPath, tenantIdFromToken } from '../src/api/tenant-context.js';

function token(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('extracts tenant id from a signed-token payload shape', () => {
  assert.equal(tenantIdFromToken(token({ tenantId: 'tenant-a' })), 'tenant-a');
  assert.equal(tenantIdFromToken('invalid'), null);
});

test('overwrites caller supplied tenantId with the authenticated tenant', () => {
  const result = normalizeTenantPath('/api/v1/tenant/users?tenantId=tenant-b&page=2', token({ tenantId: 'tenant-a' }), 'https://api.example.com');
  assert.equal(result, '/api/v1/tenant/users?tenantId=tenant-a&page=2');
});

test('keeps the path unchanged when token has no tenant context', () => {
  const path = '/api/v1/tenant/users?page=2';
  assert.equal(normalizeTenantPath(path, token({ domain: 'platform' }), 'https://api.example.com'), path);
});
