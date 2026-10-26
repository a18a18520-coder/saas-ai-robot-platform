// Explicit local query verification. Conversation and tool state changes are rolled back.
require('dotenv').config({ quiet: true });
const path = require('path');
const release = require('../../.runtime/release.json');
const load = p => require(path.join(release.backend, p));
const db = load('database/data-source').default;
const { ConfigService } = require('@nestjs/config');
(async () => {
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  try {
    const repo = n => runner.manager.getRepository(n);
    const draft = await repo('Robot').findOneByOrFail({ id: '37052eca-3fb4-45b6-8e5b-2c9958040adb' });
    const robot = { ...draft, ...draft.publishedConfig };
    const conversation = await repo('Conversation').findOneByOrFail({ id: '3c1a070b-cc81-4411-bd3d-044716b964c0' });
    const secrets = new (load('secrets/secrets.service').SecretsService)(new ConfigService(process.env));
    const usage = new (load('models/model-usage.service').ModelUsageService)(db);
    const models = new (load('models/models.service').ModelsService)(repo('ModelConfig'), secrets, usage);
    const executor = new (load('ai-router/tool-executor.service').ToolExecutorService)(repo('Tool'), secrets, models);
    const answers = new (load('ai-router/answer.service').AnswerService)(models, repo('Conversation'), repo('Message'), executor);
    await answers.applyTenantModels(robot);
    const flow = new (load('ai-router/tool-conversation.service').ToolConversationService)(repo('Tool'), repo('Conversation'), models, executor, answers);
    const result = await flow.handle(robot, conversation, '查询案件 CAS-2026-MOCK-005 的状态', ['legal_case_query'], ['用户']);
    console.log(JSON.stringify({ publishedToolsEnabled: robot.ragConfig.toolsEnabled, answer: result }));
    if (typeof result !== 'string' || !result.includes('CAS-2026-MOCK-005')) throw new Error('未返回目标案件');
  } finally {
    await runner.rollbackTransaction(); await runner.release(); await db.destroy();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
