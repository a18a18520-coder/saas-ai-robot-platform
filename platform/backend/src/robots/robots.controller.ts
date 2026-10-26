import { ModelsService } from '../models/models.service';
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Robot } from './robot.entity';
import { Group } from '../groups/group.entity';
import { AuditService } from '../audit/audit.service';
import { validateCollectionConfig } from './collection-config';

/** 租户侧机器人管理（FR-002）——CRUD + 发布 + 生命周期，全部写操作入审计 */
@Controller('api/v1/tenant/robots')
export class RobotsController {
  constructor(
    @InjectRepository(Robot) private readonly repo: Repository<Robot>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly audit: AuditService,
    private readonly models: ModelsService,
  ) {}

  @Get()
  list(@Query('tenantId') tenantId: string): Promise<Robot[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  @Post()
  async create(@Body() body: Partial<Robot>): Promise<Robot> {
    this.assertPlatformBinding(body);
    this.assertTenantModels(body.ragConfig);
    const { name, type, description, tenantId, difyAppId, workflowId, kbPool, toolIdentifiers, humanHandoff, ragConfig } = body;
    if (ragConfig) await this.validateConfig(tenantId!, ragConfig);
    const robot = await this.repo.save(this.repo.create({ name, type, description, tenantId, difyAppId, workflowId, kbPool, toolIdentifiers, humanHandoff, ragConfig, status: 'DRAFT' }));
    await this.audit.log({
      tenantId: robot.tenantId, robotId: robot.id, question: `[机器人] 创建（${robot.name}）`,
      result: `草稿 · 类型 ${robot.type}${robot.difyAppId ? ` · 绑定 ${robot.difyAppId.slice(0, 8)}…` : '（未绑定 Dify）'}`,
    }).catch(() => undefined);
    return robot;
  }

  @Get(':id')
  detail(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Robot | null> {
    return this.repo.findOne({ where: { id, tenantId } });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: Partial<Robot>): Promise<Robot | null> {
    const robot = await this.repo.findOne({ where: { id, tenantId } });
    if (!robot) return null;
    this.assertPlatformBinding(body, robot);
    const allowed = ['name', 'type', 'description', 'kbPool', 'toolIdentifiers', 'humanHandoff', 'ragConfig'] as const;
    if (body.ragConfig !== undefined) {
      this.assertTenantModels(body.ragConfig, robot.ragConfig);
      body = { ...body, ragConfig: { ...body.ragConfig, primaryModelId: robot.ragConfig?.primaryModelId, fallbackModelId: robot.ragConfig?.fallbackModelId, rerankModelId: robot.ragConfig?.rerankModelId } };
      await this.validateConfig(tenantId, { ...body.ragConfig, primaryModelId: undefined, fallbackModelId: undefined, rerankModelId: undefined });
    }
    const changed = allowed.filter((key) => body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(robot[key]));
    for (const key of allowed) if (body[key] !== undefined) (robot as unknown as Record<string, unknown>)[key] = body[key];
    const saved = await this.repo.save(robot);
    if (changed.length) {
      await this.audit.log({
        tenantId: robot.tenantId, robotId: robot.id, question: `[机器人] 编辑（${saved.name}）`,
        result: `变更: ${changed.join(', ')}`,
      }).catch(() => undefined);
    }
    return saved;
  }

  @Post(':id/restore-config')
  async restoreConfig(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { version: number }) {
    const robot = await this.repo.findOne({ where: { id, tenantId } });
    const version = robot?.configHistory?.find(v => v.version === body.version);
    if (!robot || !version) throw new HttpException('配置版本不存在', HttpStatus.NOT_FOUND);
    const restored = { ...version.config } as Partial<Robot>;
    delete restored.difyAppId;
    delete restored.workflowId;
    if (restored.ragConfig) {
      restored.ragConfig = { ...restored.ragConfig };
      delete restored.ragConfig.primaryModelId;
      delete restored.ragConfig.fallbackModelId;
      delete restored.ragConfig.rerankModelId;
    }
    return this.update(id, tenantId, restored);
  }

  private assertPlatformBinding(body: Partial<Robot>, current?: Robot) {
    for (const key of ['difyAppId', 'workflowId'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== current?.[key]) {
        throw new HttpException('Dify Agent 和工作流由平台配置，租户不能修改', HttpStatus.FORBIDDEN);
      }
    }
  }

  private assertTenantModels(config?: Robot['ragConfig'], current?: Robot['ragConfig']) {
    if (config === undefined) return;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpException('机器人配置格式无效', HttpStatus.BAD_REQUEST);
    for (const key of ['primaryModelId', 'fallbackModelId', 'rerankModelId'] as const) {
      if (Object.prototype.hasOwnProperty.call(config, key) && config[key] !== current?.[key]) throw new HttpException('模型由平台统一配置，租户不能修改', HttpStatus.FORBIDDEN);
    }
  }

  private async validateConfig(tenantId: string, config: Robot['ragConfig']) {
    if (config.mode !== undefined && !['qa', 'collector'].includes(config.mode)) throw new HttpException('机器人工作模式无效', HttpStatus.BAD_REQUEST);
    if (config.collection !== undefined) validateCollectionConfig(config.collection);
    if (config.rerankModelId) await this.models.resolve(config.rerankModelId, tenantId, 'rerank');
    if (config.wikiRootIds && (!Array.isArray(config.wikiRootIds) || config.wikiRootIds.some(id => typeof id !== 'string'))) throw new HttpException('Wiki 范围无效', HttpStatus.BAD_REQUEST);
    if (config.primaryModelId) await this.models.resolve(config.primaryModelId, tenantId);
    if (config.fallbackModelId) await this.models.resolve(config.fallbackModelId, tenantId);
    const fail = (message: string) => { throw new HttpException(message, HttpStatus.BAD_REQUEST); };
    if (config.answerDetail && !['concise', 'detailed'].includes(config.answerDetail)) fail('回答详略无效');
    for (const field of ['personality', 'tone', 'responseFormat'] as const) {
      if (config[field] !== undefined && (typeof config[field] !== 'string' || config[field].length > 2000)) fail('性格、语气和回复格式各需为不超过 2000 字的文本');
    }
    if (config.systemPrompt && (typeof config.systemPrompt !== 'string' || config.systemPrompt.length > 12000)) fail('提示词过长');
    if (config.topK !== undefined && (!Number.isInteger(config.topK) || config.topK < 1 || config.topK > 20)) fail('召回数量需为 1–20');
    if (config.historyTurns !== undefined && (!Number.isInteger(config.historyTurns) || config.historyTurns < 1 || config.historyTurns > 20)) fail('历史轮次需为 1–20');
    if (config.compressionThreshold !== undefined && (!Number.isFinite(config.compressionThreshold) || config.compressionThreshold < 0.2 || config.compressionThreshold > 0.8)) fail('压缩阈值需为 0.2–0.8');
    if (config.scoreThreshold !== undefined && (!Number.isFinite(config.scoreThreshold) || config.scoreThreshold < 0 || config.scoreThreshold > 1)) fail('分数阈值需为 0–1');
    if (config.searchMethod && !['keyword_search', 'semantic_search', 'hybrid_search'].includes(config.searchMethod)) fail('检索模式无效');
  }

  /** 发布（Dify 绑定验证在 M3 完成，先落状态） */
  @Post(':id/publish')
  async publish(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Robot | null> {
    const robot = await this.repo.findOne({ where: { id, tenantId } });
    if (!robot) return null;
    robot.ragConfig = { ...robot.ragConfig, ...await this.models.tenantPolicy(tenantId) };
    if (!robot.ragConfig?.primaryModelId) throw new HttpException({ code: 42201, message: '需先配置对话模型', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    await this.validateConfig(tenantId, robot.ragConfig);
    if (robot.ragConfig.mode === 'collector') validateCollectionConfig(robot.ragConfig.collection, true);
    const config = Object.fromEntries(['name', 'type', 'description', 'difyAppId', 'workflowId', 'kbPool', 'toolIdentifiers', 'humanHandoff', 'ragConfig'].map(k => [k, (robot as any)[k]]));
    robot.publishedConfig = config;
    const history = robot.configHistory ?? [];
    robot.configHistory = [...history, { version: (history.at(-1)?.version ?? 0) + 1, publishedAt: new Date().toISOString(), config }].slice(-50);
    robot.status = 'PUBLISHED';
    const saved = await this.repo.save(robot);
    await this.audit.log({
      tenantId: robot.tenantId, robotId: robot.id, question: `[机器人] 发布（${saved.name}）`,
      result: `PUBLISHED · 模型 ${robot.ragConfig.primaryModelId}`,
    }).catch(() => undefined);
    return saved;
  }

  @Post(':id/disable')
  async disable(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Robot | null> {
    const robot = await this.repo.findOne({ where: { id, tenantId } });
    if (!robot) return null;
    robot.status = 'DISABLED';
    const saved = await this.repo.save(robot);
    await this.audit.log({
      tenantId: robot.tenantId, robotId: robot.id, question: `[机器人] 禁用（${saved.name}）`,
      result: 'DISABLED：群消息不再应答',
    }).catch(() => undefined);
    return saved;
  }

  /** 删除（级联：解绑引用该机器人的群，避免孤儿引用） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const robot = await this.repo.findOne({ where: { id, tenantId } });
    if (!robot) return { code: 40401, message: '机器人不存在', data: null };
    const boundGroups = await this.groups.count({ where: { tenantId, robotId: id } });
    await this.groups.update({ tenantId, robotId: id }, { robotId: null });
    await this.repo.delete(id);
    await this.audit.log({
      tenantId, robotId: id, question: `[机器人] 删除（${robot.name}）`,
      result: `级联解绑 ${boundGroups} 个群引用`,
    }).catch(() => undefined);
    return { code: 0, message: 'success', data: { id } };
  }
}
