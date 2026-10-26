import assert from 'node:assert/strict';
import test from 'node:test';
import { readApiJson } from '../src/api/response.js';

test('rejects an unrelated SPA HTML response even when HTTP is 200', async () => {
  await assert.rejects(readApiJson(new Response('<html>other project</html>', { headers: { 'content-type': 'text/html' } })), /正确的平台地址/);
});
test('reports backend outages instead of swallowing proxy errors', async () => {
  await assert.rejects(readApiJson(new Response('', { status: 502 })), /后端服务暂不可用/);
});
test('preserves JSON authorization failures for normal login handling', async () => {
  const body = { code: 40101, message: 'expired' };
  assert.deepEqual(await readApiJson(Response.json(body, { status: 401 })), body);
});
test('accepts API JSON and empty successful responses, rejects malformed JSON', async () => {
  assert.deepEqual(await readApiJson(Response.json({ data: [] })), { data: [] });
  assert.equal(await readApiJson(new Response(null, { status: 204 })), null);
  await assert.rejects(readApiJson(new Response('{', { headers: { 'content-type': 'application/json' } })), /不完整/);
});
