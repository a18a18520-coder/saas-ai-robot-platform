// Run: node -r ts-node/register test/collection.integration.cjs
// Optional real model: COLLECTION_LIVE_TEST=1 node -r ts-node/register test/collection.integration.cjs
// All fixtures, tenant expiry changes, quota and telemetry are rolled back.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../src/app.module');
const { Robot } = require('../src/robots/robot.entity');
const { Group } = require('../src/groups/group.entity');
const { CollectionRecord } = require('../src/robots/collection-record.entity');
const { CollectionService } = require('../src/ai-router/collection.service');
const { AiRouterService } = require('../src/ai-router/ai-router.service');
const { AiQuotaService } = require('../src/ai-router/ai-quota.service');
const { Tenant } = require('../src/tenants/tenant.entity');
const { Plan } = require('../src/plans/plan.entity');
const { Notification } = require('../src/notifications/notification.entity');
const { ModelsService } = require('../src/models/models.service');
const { ModelConfig } = require('../src/models/model.entity');
const { ModelUsageService } = require('../src/models/model-usage.service');
const { SecretsService } = require('../src/secrets/secrets.service');

(async () => {
  const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const rollback = new Error('intentional fixture rollback');
  let tenantId, robotId;
  try {
    const db = app.get(DataSource);
    await db.transaction(async manager => {
      const [tenant] = await manager.query("SELECT t.id FROM tenants t JOIN tenant_model_policies p ON p.tenant_id=t.id WHERE t.status='ACTIVE' AND p.config->>'primaryModelId' <> '' LIMIT 1");
      assert.ok(tenant, '需要一个已配置模型的活动租户'); tenantId = tenant.id;
      await manager.query("UPDATE tenants SET subscription_end=CURRENT_DATE + 1, ai_quota_used=0 WHERE id=$1", [tenantId]);
      const config = { trigger: 'all', prompt: '只收集明确的设备故障上报，忽略其他消息。', constraints: '仅从本条消息提取；没有说明则填 null；不要编造。', keywords: ['故障'], fields: [
        { key: 'device', label: '设备编号', type: 'string', required: true, description: '完整设备编号，保留原文大小写及连字符' },
        { key: 'issue', label: '故障描述', type: 'string', required: true, description: '提取具体故障现象' },
      ] };
      const robot = await manager.save(Robot, manager.create(Robot, { tenantId, name: '收集器事务验收', type: '信息收集机器人', status: 'PUBLISHED', ragConfig: { mode: 'collector', collection: config }, publishedConfig: { ragConfig: { mode: 'collector', collection: config } } }));
      robotId = robot.id;
      const group = await manager.save(Group, manager.create(Group, { tenantId, robotId, name: '内部收集验收', chatId: `collection-test-${randomUUID()}`, channel: 'web', status: 'BOUND' }));
      const quota = new AiQuotaService(manager.getRepository(Tenant), manager.getRepository(Plan), manager.getRepository(Notification));
      const realModels = new ModelsService(manager.getRepository(ModelConfig), app.get(SecretsService), new ModelUsageService(manager));
      let generated = 0, invalid = false;
      const model = { tenantPolicy: id => realModels.tenantPolicy(id), generate: async () => {
        generated++;
        return { modelId: randomUUID(), text: invalid ? 'invalid' : JSON.stringify({ matched: true, reason: '设备故障', items: [{ values: { device: 'DEVICE-DEMO-17', issue: '屏幕无法点亮' }, evidence: { device: 'DEVICE-DEMO-17', issue: '屏幕无法点亮' } }] }) };
      } };
      const filter = { filter: async text => ({ action: 'ALLOWED', text }) };
      const identity = { resolve: async () => ({ user: { id: 'test-user', status: 'ACTIVE' } }) };
      const records = manager.getRepository(CollectionRecord);
      const service = new CollectionService(records, manager.getRepository(Robot), manager.getRepository(Group), model, quota, filter, identity);
      const router = new AiRouterService(manager.getRepository(Robot), manager.getRepository(Group), {}, {}, {}, {}, {}, {}, {}, {}, filter, quota, manager.getRepository(Tenant), {}, {}, undefined, undefined, service);
      const input = { tenantId, channel: 'web', chatId: group.chatId, channelUserId: 'test-user', sourceMessageId: 'm-1', isAtRobot: false, content: '故障上报：设备编号 DEVICE-DEMO-17，屏幕无法点亮。' };
      const concurrent = await Promise.all([router.handleMessage(input), router.handleMessage(input)]);
      assert.equal(generated, 1); assert.equal(await records.countBy({ robotId }), 1);
      assert.ok(concurrent.some(r => r.reason === 'duplicate'));
      assert.ok(concurrent.some(r => r.collectionStatus === 'collected'));
      assert.ok(concurrent.every(r => !r.answer && !r.handoffId));
      // Identical text with a distinct source ID is a distinct report.
      await router.handleMessage({ ...input, sourceMessageId: 'm-2' });
      assert.equal(generated, 2); assert.equal(await records.countBy({ robotId }), 2);
      const ignored = await router.handleMessage({ ...input, sourceMessageId: 'm-3', content: '大家早上好' });
      assert.equal(ignored.collectionStatus, 'ignored'); assert.equal(generated, 2);
      invalid = true;
      const failed = await router.handleMessage({ ...input, sourceMessageId: 'm-4' });
      assert.equal(failed.collectionStatus, 'failed'); invalid = false;
      const retries = await Promise.allSettled([service.retry(tenantId, robotId, failed.collectionId), service.retry(tenantId, robotId, failed.collectionId)]);
      assert.equal(retries.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await records.findOneByOrFail({ id: failed.collectionId })).status, 'collected');
      assert.equal((await records.findOneByOrFail({ id: failed.collectionId })).validationVersion, 3);
      await assert.rejects(service.list('foreign-tenant', robotId), /机器人不存在/);
      assert.equal((await service.list(tenantId, robotId)).total, 4);
      if (process.env.COLLECTION_LIVE_TEST === '1') {
        const live = new CollectionService(records, manager.getRepository(Robot), manager.getRepository(Group), realModels, quota, filter, identity);
        const result = await live.ingest(robot, group, { ...input, sourceMessageId: 'live-model' });
        const row = await records.findOneByOrFail({ id: result.collectionId });
        assert.equal(row.status, 'collected', row.reason);
        assert.equal(row.items[0].values.device, 'DEVICE-DEMO-17');
        assert.ok(row.items[0].evidence.issue.includes('无法点亮'));
        console.log(JSON.stringify({ test: 'real-model', status: row.status, items: row.items }));
        const strictConfig = { ...config, keywords: [], prompt: '提取明确的金额、截止日期和确认状态。必须逐字段遵守配置的原文标签、类型和转换规则。不确定填 null。', fields: [
          { key: 'amount', label: '金额（元）', type: 'number', required: true, description: '万元转换为元', rules: { sourceLabel: '金额', sourceUnit: '万元', multiplier: 10000, minimum: 0, maximum: 50000 } },
          { key: 'due', label: '截止日期', type: 'string', required: true, description: '明确的年月日', rules: { sourceLabel: '截止日期', format: 'date' } },
          { key: 'confirmed', label: '已确认', type: 'boolean', required: true, description: '是为 true，否为 false', rules: { sourceLabel: '已确认' } },
        ] };
        const converted = await live.preview(tenantId, robotId, strictConfig, '金额：1.2万元；截止日期：2026年10月23日；已确认：否。');
        assert.equal(converted.status, 'collected', JSON.stringify(converted));
        assert.deepEqual(converted.items[0].values, { amount: 12000, due: '2026-10-23', confirmed: false });
        const uncertain = await live.preview(tenantId, robotId, strictConfig, '金额：约1.2万元；截止日期：明天；已确认：不是。');
        assert.notEqual(uncertain.status, 'collected', '不确定表达不能伪装为严格校验成功');
        console.log(JSON.stringify({ test: 'strict-real-model', values: converted.items[0].values, uncertainStatus: uncertain.status }));
      }
      console.log(JSON.stringify({ test: 'database-router', concurrentDedup: true, retryLock: true, distinctMessagesPreserved: true, tenantIsolation: true, silent: true, records: await records.countBy({ robotId }) }));
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
  finally {
    if (robotId) assert.equal(await app.get(DataSource).getRepository(CollectionRecord).countBy({ robotId }), 0, '测试数据未回滚');
    await app.close();
  }
  console.log('PASS: transaction rolled back; no channel messages sent');
})().catch(e => { console.error(e); process.exitCode = 1; });
