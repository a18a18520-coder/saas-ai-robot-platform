'use strict';
// Real local HTTP + platform controller/guard/router/validator. Dependencies that
// could touch a database, model provider, tenant quota or chat channel are fixtures.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { Store } = require('../src/core/store.cjs');
const { Uploader } = require('../src/core/uploader.cjs');
const { createCapture, messageBody } = require('../src/core/validation.cjs');

async function main() {
  if (!process.argv[2]) throw new Error('请传入 SaaS 平台仓库路径；测试不会读取 .env 或连接数据库');
  const backend = path.resolve(process.argv[2], 'backend');
  const platformRequire = createRequire(path.join(backend, 'package.json'));
  platformRequire('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
  const { Test } = platformRequire('@nestjs/testing');
  const { UnauthorizedException } = platformRequire('@nestjs/common');
  const { ApiAuthGuard } = require(path.join(backend, 'src/auth/api-auth.guard.ts'));
  const { AiRouterController } = require(path.join(backend, 'src/ai-router/ai-router.controller.ts'));
  const { AiRouterService } = require(path.join(backend, 'src/ai-router/ai-router.service.ts'));
  const { CollectionService } = require(path.join(backend, 'src/ai-router/collection.service.ts'));
  const { TransformInterceptor } = require(path.join(backend, 'src/common/interceptors/transform.interceptor.ts'));
  const config = { trigger: 'all', prompt: '仅收集原文明示字段', constraints: '不得编造', keywords: [], fields: [
    { key: 'amount', label: '金额', type: 'number', required: true, description: '', rules: { sourceLabel: '金额', sourceUnit: '万元', multiplier: 10000 } },
    { key: 'confirmed', label: '已确认', type: 'boolean', required: true, description: '', rules: { sourceLabel: '已确认' } },
    { key: 'owner', label: '负责人', type: 'string', required: true, description: '', rules: { sourceLabel: '负责人' } },
  ] };
  const robot = { id: randomUUID(), tenantId: 'synthetic-tenant', status: 'PUBLISHED', publishedConfig: { ragConfig: { mode: 'collector', collection: config } } };
  const group = { id: randomUUID(), tenantId: robot.tenantId, robotId: robot.id, channel: 'wechat', chatId: 'synthetic-group', status: 'BOUND' };
  const rows = new Map(); let modelCalls = 0, charges = 0, mode = 'valid';
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const records = {
    create: row => ({ id: randomUUID(), ...structuredClone(row) }),
    createQueryBuilder: () => {
      let row;
      const query = { insert: () => query, into: () => query, values: value => { row = value; return query; }, orIgnore: () => query, returning: () => query, execute: async () => {
        if ([...rows.values()].some(old => old.tenantId === row.tenantId && old.robotId === row.robotId && old.eventKey === row.eventKey)) return { raw: [] };
        rows.set(row.id, structuredClone(row)); return { raw: [{ id: row.id }] };
      } }; return query;
    },
    findOneOrFail: async ({ where }) => { const row = [...rows.values()].find(row => matches(row, where)); assert.ok(row); return structuredClone(row); },
    save: async row => { rows.set(row.id, structuredClone(row)); return row; },
  };
  const robots = { findOne: async ({ where }) => matches(robot, where) ? robot : null };
  const groups = { findOne: async ({ where }) => matches(group, where) ? group : null };
  const models = { tenantPolicy: async () => ({ primaryModelId: 'synthetic-model' }), generate: async () => {
    modelCalls++;
    return { modelId: 'synthetic-model', text: JSON.stringify({ matched: true, reason: '合成测试', items: [{
      values: { amount: mode === 'wrong-type' ? '12000' : 12000, confirmed: false, owner: mode === 'truncated' ? '张三' : '张三丰' },
      evidence: { amount: '1.2万元', confirmed: '否', owner: mode === 'truncated' ? '张三' : '张三丰' },
    }] }) };
  } };
  const quota = { consume: async () => { charges++; return { allowed: true }; } };
  const filter = { filter: async text => ({ action: 'ALLOWED', text }) };
  const identity = { resolve: async () => ({ user: { status: 'ACTIVE' } }) };
  const collection = new CollectionService(records, robots, groups, models, quota, filter, identity);
  const tenants = { findOne: async ({ where }) => where.id === robot.tenantId && where.status === 'ACTIVE' ? { id: robot.tenantId } : null };
  const router = new AiRouterService(robots, groups, {}, {}, {}, {}, {}, {}, {}, {}, filter, quota, tenants, {}, {}, undefined, undefined, collection);
  const account = windows => ({ roleId: 'synthetic-role', roleName: '测试角色', authority: 'ADMIN', windows, account: { sessionVersion: 0, mustChangePassword: false } });
  const auth = { verifyAccessToken: token => {
    if (!['synthetic-allowed', 'synthetic-denied', 'synthetic-platform'].includes(token)) throw new UnauthorizedException();
    return { domain: token === 'synthetic-platform' ? 'platform' : 'tenant', tenantId: robot.tenantId, sub: token, role: 'ADMIN', roleId: 'synthetic-role', windows: token === 'synthetic-denied' ? [] : ['messages'], sessionVersion: 0 };
  } };
  const roles = { accountAccess: async id => account(id === 'synthetic-denied' ? [] : ['messages']) };
  const testing = await Test.createTestingModule({ controllers: [AiRouterController], providers: [{ provide: AiRouterService, useValue: router }] }).compile();
  const app = testing.createNestApplication({ logger: false });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-http-contract-'));
  try {
    app.useGlobalGuards(new ApiAuthGuard(auth, roles));
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const store = new Store(path.join(dir, 'synthetic.enc'), { encode: value => Buffer.from(value), decode: value => value.toString() });
    await store.load();
    const capture = createCapture({ dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', ocrText: '金额：1.2万元；已确认：否；负责人：张三丰。', confidence: 94, sourceName: '合成窗口' });
    await store.addCapture(capture);
    const input = { content: capture.ocrText, chatLabel: '合成群', channelId: 'synthetic-device', chatId: group.chatId, channelUserId: 'synthetic-member', confirmed: true };
    const record = await store.review(capture.id, input);
    const uploader = new Uploader(store);
    const connection = { origin, token: 'synthetic-allowed' };
    const delivered = await uploader.send(record.id, connection);
    assert.equal(delivered.collectionStatus, 'collected');
    const saved = rows.get(delivered.collectionId);
    assert.deepEqual(saved.items[0].values, { amount: 12000, confirmed: false, owner: '张三丰' });
    assert.equal(saved.validationVersion, 3); assert.equal(saved.channelId, 'synthetic-device');
    assert.equal(modelCalls, 1); assert.equal(charges, 1);
    assert.ok(!(await fs.readFile(store.file, 'utf8')).includes(connection.token));
    const post = async (body, token = connection.token) => {
      const response = await fetch(`${origin}/api/v1/tenant/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const responseBody = await response.json();
      return { status: response.status, body: responseBody.data ?? responseBody };
    };
    const payload = messageBody(record);
    const duplicate = await post(payload);
    assert.equal(duplicate.body.reason, 'duplicate'); assert.equal(duplicate.body.collectionId, delivered.collectionId);
    for (const change of [{ content: '金额：2万元' }, { channelUserId: 'another-member' }]) assert.equal((await post({ ...payload, ...change })).status, 409);
    assert.equal((await post(payload, '')).status, 401);
    assert.equal((await post(payload, 'synthetic-invalid')).status, 401);
    assert.equal((await post(payload, 'synthetic-denied')).status, 403);
    assert.equal((await post(payload, 'synthetic-platform')).status, 403);
    assert.equal((await post({ ...payload, tenantId: 'foreign-tenant' })).status, 403);
    assert.equal(modelCalls, 1); assert.equal(charges, 1); assert.equal(rows.size, 1);
    const unbound = await store.review(capture.id, { ...input, chatId: 'unknown-group' });
    await assert.rejects(uploader.send(unbound.id, connection), /未返回有效的收集记录/);
    assert.equal(store.snapshot().records.find(row => row.id === unbound.id).delivery, null);
    for (const failure of ['wrong-type', 'truncated']) {
      mode = failure;
      const next = await store.review(capture.id, input);
      const result = await uploader.send(next.id, connection);
      assert.equal(result.collectionStatus, 'failed');
      assert.deepEqual(rows.get(result.collectionId).items, []);
      assert.equal(rows.get(result.collectionId).validationErrors[0].code, failure === 'wrong-type' ? 'FIELD_TYPE' : 'FIELD_RULE');
    }
    assert.equal(rows.size, 3); assert.equal(modelCalls, 3); assert.equal(charges, 3);
    console.log('PASS: real local HTTP, platform guard/router/validator, false + exact unit conversion, duplicate/conflict, tenant/role boundaries, failed-result handling; synthetic repositories and model only.');
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
