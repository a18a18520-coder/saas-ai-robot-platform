// Live local deployment acceptance. No real chat, existing tenant, paid model or
// auth bypass: a temporary account signs in through the normal password endpoint.
require('dotenv/config');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  if (!process.argv.includes('--allow-local-fixtures')) throw new Error('需要 --allow-local-fixtures；仅创建并清理本机合成测试数据');
  const origin = new URL(process.env.COLLECTION_TEST_ORIGIN || 'http://127.0.0.1:5175');
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, '仅允许本机服务');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost'), '仅允许本机数据库');
  const collectorRoot = path.resolve(process.env.COLLECTOR_PROJECT || '../../wechat-collector');
  const { Store } = require(path.join(collectorRoot, 'src/core/store.cjs'));
  const { Uploader } = require(path.join(collectorRoot, 'src/core/uploader.cjs'));
  const { createCapture, messageBody } = require(path.join(collectorRoot, 'src/core/validation.cjs'));
  const tenantId = randomUUID(), planId = randomUUID(), modelId = randomUUID(), groupId = randomUUID();
  const roleIds = [randomUUID(), randomUUID()], accountIds = [randomUUID(), randomUUID()];
  const prefix = `COLLECTOR-ACCEPTANCE-${tenantId}`;
  const accounts = accountIds.map(id => `${id}@collector-test.invalid`);
  const password = `Aa!${randomBytes(24).toString('hex')}`;
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
  const content = 'COLLECTOR_ACCEPTANCE 金额：1.2万元；已确认：否；负责人：张三丰。';
  const config = { trigger: 'all', prompt: '仅从本条合成消息提取已明示的字段', constraints: '禁止猜测', keywords: [], fields: [
    { key: 'amount', label: '金额', type: 'number', required: true, description: '', rules: { sourceLabel: '金额', sourceUnit: '万元', multiplier: 10000 } },
    { key: 'confirmed', label: '已确认', type: 'boolean', required: true, description: '', rules: { sourceLabel: '已确认' } },
    { key: 'owner', label: '负责人', type: 'string', required: true, description: '', rules: { sourceLabel: '负责人' } },
  ] };
  let modelCalls = 0, responseMode = 'valid';
  const mock = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions');
      let raw = '';
      for await (const part of req) { raw += part; if (raw.length > 100000) throw new Error('oversized'); }
      const request = JSON.parse(raw);
      assert.equal(request.model, modelId);
      assert.ok(JSON.parse(request.messages.at(-1).content).source_message.startsWith('COLLECTOR_ACCEPTANCE'));
      modelCalls++;
      const values = { amount: responseMode === 'type' ? '12000' : 12000, confirmed: false, owner: responseMode === 'truncated' ? '张三' : responseMode === 'missing' ? null : '张三丰' };
      const evidence = { amount: '1.2万元', confirmed: '否', ...(values.owner === null ? {} : { owner: values.owner }) };
      const result = { matched: true, reason: '合成验收模型固定响应', items: [{ values, evidence }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"synthetic test request rejected"}'); }
  });
  const db = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'robot', password: process.env.DB_PASS || 'robot', database: process.env.DB_NAME || 'robot_platform' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-deployed-'));
  let connected = false, token, robotId;
  async function api(route, body, access = token, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${origin.origin}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const raw = await response.json(); return { status: response.status, raw, data: raw?.code === 0 ? raw.data : raw };
  }
  async function login(account) {
    const response = await api('/api/v1/platform/auth/tenant/login', { account, password }, null);
    assert.equal(response.raw.code, 0, '合成账号登录失败');
    assert.equal(response.data.tenantId, tenantId); assert.equal(response.data.mustChangePassword, false);
    return response.data.access_token;
  }
  try {
    await db.connect(); connected = true;
    assert.equal((await db.query("select column_default from information_schema.columns where table_schema='public' and table_name='collection_records' and column_name='validationVersion'")).rows[0]?.column_default, '3');
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    await db.query('BEGIN');
    await db.query('INSERT INTO plans (id,name,price,ai_quota,is_active) VALUES ($1,$2,0,1000,false)', [planId, prefix]);
    await db.query("INSERT INTO tenants (id,name,plan_id,status,cycle_start_at,subscription_end,admin_email,admin_account_id,config) VALUES ($1,$2,$3,'ACTIVE',CURRENT_DATE,CURRENT_DATE+7,$4,$5,'{}')", [tenantId, prefix, planId, accounts[0], accountIds[0]]);
    for (let i = 0; i < 2; i++) {
      await db.query('INSERT INTO roles (id,tenant_id,name) VALUES ($1,$2,$3)', [roleIds[i], tenantId, `合成角色 ${i}`]);
      for (const permission of i ? ['robots'] : ['robots', 'groups', 'messages']) await db.query("INSERT INTO role_permissions (role_id,resource_type,resource_id) VALUES ($1,'window',$2)", [roleIds[i], permission]);
      await db.query("INSERT INTO tenant_accounts (id,tenant_id,name,account,password_hash,role,role_id,password_changed_at) VALUES ($1,$2,'合成验收账号',$3,$4,'TENANT_OPS',$5,now())", [accountIds[i], tenantId, accounts[i], passwordHash, roleIds[i]]);
    }
    await db.query('INSERT INTO model_configs (id,name,base_url,model,context_window,max_output_tokens,timeout_ms,tenant_ids) VALUES ($1,$2,$3,$5,65536,1024,5000,$4)', [modelId, prefix, `http://127.0.0.1:${mock.address().port}/v1`, JSON.stringify([tenantId]), modelId]);
    await db.query('INSERT INTO tenant_model_policies (tenant_id,config) VALUES ($1,$2)', [tenantId, JSON.stringify({ primaryModelId: modelId, fallbackModelId: '', rerankModelId: '' })]);
    await db.query("INSERT INTO groups (id,tenant_id,chat_id,name,channel,status) VALUES ($1,$2,$3,'合成验收群','wechat','PENDING')", [groupId, tenantId, prefix]);
    await db.query('COMMIT');
    token = await login(accounts[0]);
    const limitedToken = await login(accounts[1]);
    const created = await api('/api/v1/tenant/robots', { name: '合成信息收集机器人', type: '信息收集机器人', ragConfig: { mode: 'collector', collection: config } });
    assert.equal(created.status, 201); assert.equal(created.data.status, 'DRAFT'); robotId = created.data.id;
    const published = await api(`/api/v1/tenant/robots/${robotId}/publish`, {});
    assert.equal(published.data.status, 'PUBLISHED'); assert.equal(published.data.publishedConfig.ragConfig.collection.trigger, 'all');
    const bound = await api(`/api/v1/tenant/groups/${groupId}/bind`, { robotId });
    assert.equal(bound.data.status, 'BOUND');
    console.log('PASS: deployed frontend proxy, normal password login, role mapping, create/publish and synthetic group binding');
    const store = new Store(path.join(dir, 'synthetic.json'), { encode: text => Buffer.from(text), decode: bytes => bytes.toString() });
    const capture = createCapture({ dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', ocrText: content, confidence: 94, sourceName: '合成验收窗口' });
    await store.addCapture(capture);
    const fields = { content, chatLabel: '合成验收群', channelId: 'synthetic-device', chatId: prefix, channelUserId: 'synthetic-member', confirmed: true };
    const uploader = new Uploader(store);
    const submit = async () => { const record = await store.review(capture.id, fields); return { record, delivered: await uploader.send(record.id, { origin: origin.origin, token }) }; };
    const first = await submit();
    assert.equal(first.delivered.collectionStatus, 'collected');
    const saved = (await db.query('SELECT * FROM collection_records WHERE id=$1 AND "tenantId"=$2', [first.delivered.collectionId, tenantId])).rows[0];
    assert.equal(saved.validationVersion, 3);
    assert.deepEqual(saved.items[0].values, { amount: 12000, confirmed: false, owner: '张三丰' });
    const body = messageBody(first.record);
    const duplicate = await Promise.all([api('/api/v1/tenant/messages', body), api('/api/v1/tenant/messages', body)]);
    assert.ok(duplicate.every(row => row.data.reason === 'duplicate' && row.data.collectionId === saved.id));
    assert.equal(modelCalls, 1);
    for (const change of [{ content: content + '修改' }, { channelUserId: 'another-member' }]) assert.equal((await api('/api/v1/tenant/messages', { ...body, ...change })).status, 409);
    assert.equal((await api('/api/v1/tenant/messages', body, limitedToken)).status, 403);
    assert.equal((await api('/api/v1/tenant/messages', { ...body, tenantId: randomUUID() })).status, 403);
    assert.equal((await api('/api/v1/tenant/messages', body, null)).status, 401);
    assert.equal(modelCalls, 1);
    assert.equal((await submit()).delivered.collectionStatus, 'collected');
    console.log('PASS: collector client → running API → local model stub → PostgreSQL; no-mention, exact 12000, false, dedup/conflict and auth boundaries');
    for (const mode of ['type', 'truncated', 'missing']) {
      responseMode = mode;
      const result = await submit();
      assert.equal(result.delivered.collectionStatus, mode === 'missing' ? 'needs_review' : 'failed');
      const row = (await db.query('SELECT items,"validationErrors" FROM collection_records WHERE id=$1 AND "tenantId"=$2', [result.delivered.collectionId, tenantId])).rows[0];
      if (mode !== 'missing') {
        assert.deepEqual(row.items, []);
        assert.equal(row.validationErrors[0].code, mode === 'type' ? 'FIELD_TYPE' : 'FIELD_RULE');
        responseMode = 'valid';
        const retried = await api(`/api/v1/tenant/robots/${robotId}/collections/${result.delivered.collectionId}/retry`, {});
        assert.equal(retried.data.collectionStatus, 'collected');
      } else assert.deepEqual(row.items[0].missingFields, ['owner']);
    }
    responseMode = 'valid';
    const invalidPreview = await api(`/api/v1/tenant/robots/${robotId}/collection-preview`, { config: { ...config, fields: [{ ...config.fields[0], rules: { multiplier: 0 } }] }, content });
    assert.equal(invalidPreview.status, 400);
    const beforeDraft = modelCalls;
    await api(`/api/v1/tenant/robots/${robotId}`, { ragConfig: { mode: 'collector', collection: { ...config, trigger: 'mention' } } }, token, 'PATCH');
    assert.equal((await submit()).delivered.collectionStatus, 'collected', '草稿不得修改已发布触发条件');
    assert.equal(modelCalls, beforeDraft + 1);
    await api(`/api/v1/tenant/robots/${robotId}/publish`, {});
    const notAt = await api('/api/v1/tenant/messages', { ...body, sourceMessageId: `local:${randomUUID()}` });
    assert.equal(notAt.data.reason, 'not_at_robot'); assert.equal(modelCalls, beforeDraft + 1);
    const at = await api('/api/v1/tenant/messages', { ...body, sourceMessageId: `local:${randomUUID()}`, isAtRobot: true });
    assert.equal(at.data.collectionStatus, 'collected');
    const list = await api(`/api/v1/tenant/robots/${robotId}/collections?page=1`);
    assert.equal(list.data.total, 7); assert.ok(list.data.items.every(row => row.tenantId === tenantId && row.validationVersion === 3));
    const usage = await api(`/api/v1/tenant/robots/${robotId}/token-usage`);
    assert.equal(usage.data.totals.calls, modelCalls);
    const quota = (await db.query('SELECT ai_quota_used FROM tenants WHERE id=$1', [tenantId])).rows[0].ai_quota_used;
    assert.equal(quota, modelCalls);
    console.log(JSON.stringify({ test: 'deployed-collection', records: list.data.total, syntheticModelCalls: modelCalls, validationVersion: 3, fieldFailuresRejected: true, retry: true, missingFieldsNeedReview: true, publishedSnapshot: true, tokenUsage: true, quota: true }));
  } finally {
    try {
      if (connected) {
        await db.query('ROLLBACK');
        await db.query('BEGIN');
        // Only UUIDs generated by this invocation. Never delete a named user tenant.
        const owner = (await db.query('SELECT name FROM tenants WHERE id=$1', [tenantId])).rows[0];
        if (owner) assert.equal(owner.name, prefix, '清理对象身份不匹配，停止清理');
        await db.query('DELETE FROM group_members WHERE group_id=$1', [groupId]);
        await db.query('DELETE FROM role_permissions WHERE role_id=ANY($1::varchar[])', [roleIds]);
        const tables = (await db.query("SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema,table_name) WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.column_name IN ('tenant_id','tenantId') ORDER BY c.table_name")).rows;
        const quoted = identifier => '"' + identifier.replace(/"/g, '""') + '"';
        let removed = 0;
        for (const table of tables) removed += (await db.query(`DELETE FROM ${quoted(table.table_name)} WHERE ${quoted(table.column_name)}=$1`, [tenantId])).rowCount;
        await db.query('DELETE FROM tenants WHERE id=$1 AND name=$2', [tenantId, prefix]);
        await db.query('DELETE FROM model_configs WHERE id=$1 AND name=$2', [modelId, prefix]);
        await db.query('DELETE FROM plans WHERE id=$1 AND name=$2', [planId, prefix]);
        await db.query('COMMIT');
        for (const table of tables) assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${quoted(table.table_name)} WHERE ${quoted(table.column_name)}=$1`, [tenantId])).rows[0].count, 0, `测试数据清理未完成: ${table.table_name}`);
        for (const [table, id] of [['tenants', tenantId], ['model_configs', modelId], ['plans', planId]]) {
          assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${quoted(table)} WHERE id=$1`, [id])).rows[0].count, 0, `测试配置清理未完成: ${table}`);
        }
        console.log(`CLEANUP: removed ${removed} synthetic tenant-scoped rows plus fixture tenant/plan/model; verified no fixture rows remain.`);
      }
    } finally {
      if (connected) { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); }
      await new Promise(resolve => { mock.closeAllConnections(); mock.close(() => resolve()); });
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
main().catch(error => { console.error('FAIL:', error.message); process.exitCode = 1; });
