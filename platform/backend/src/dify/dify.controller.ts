import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DifyClientService } from './dify-client.service';
import { DifyResourceService } from './dify-resource.service';
import { AuditService } from '../audit/audit.service';
import { redactLogValue } from '../common/logging/redacting-logger';

/** 平台侧 Dify 资源管理 API（FR-022）——对应 04 原型 dify-resources.html */
@Controller('api/v1/admin/dify')
export class DifyController {
  constructor(
    private readonly client: DifyClientService,
    private readonly resources: DifyResourceService,
    private readonly audit: AuditService,
  ) {}

  @Get('robots')
  listRobots(@Query('tenantId') tenantId: string) {
    return this.resources.listRobots(tenantId);
  }

  /** 同步 Dify 资源池（App/Workflow 列表） */
  @Get('resources/sync')
  async syncResources() {
    const apps = await this.client.listApps();
    return { total: apps.length, apps };
  }

  /** T-005-1: ds-key 检索冒烟（开发期验证架构 A1） */
  @Post('resources/smoke-test')
  async smokeTest(@Body() body: { datasetId: string; dsApiKey: string }) {
    return this.client.smokeTestDatasetKey(body.datasetId, body.dsApiKey);
  }

  /** 分配资源给租户（ds-key 自动创建 + 落库） */
  @Post('resources/assign')
  async assign(
    @Body() body: { tenantId: string; resourceId: string; resourceType: 'app' | 'workflow'; resourceName?: string; datasetId?: string; bindRobotId?: string },
  ) {
    const r = await this.resources.assignToTenant(body);
    await this.audit.log({
      tenantId: body.tenantId, question: `[Dify] 分配资源（${body.resourceName ?? body.resourceId.slice(0, 8)}…）`,
      result: `${body.resourceType}${body.datasetId ? ` · ds-key ${body.datasetId.slice(0, 8)}…` : ''}${body.bindRobotId ? ` · 绑定机器人 ${body.bindRobotId.slice(0, 8)}…` : ''}`,
    }).catch(() => undefined);
    return r;
  }

  /** 分配列表：按租户（租户侧数据源）或全平台 */
  @Get('resources')
  async list(@Query('tenantId') tenantId?: string) {
    if (tenantId) return this.resources.listByTenant(tenantId);
    return this.resources.listAll();
  }

  /** 解除分配（检查机器人绑定） */
  @Post('resources/:resourceId/unassign')
  async unassign(@Param('resourceId') resourceId: string, @Body() body: { tenantId: string }) {
    const r = await this.resources.unassign(body.tenantId, resourceId);
    await this.audit.log({
      tenantId: body.tenantId, question: `[Dify] 解除分配（${resourceId.slice(0, 8)}…）`,
      result: '资源已回收（机器人绑定解除）',
    }).catch(() => undefined);
    return r;
  }

  /** 白名单检索（架构 A1 核心：并发 ds-key 检索 + 合并 top-k） */
  @Post('retrieve')
  async retrieve(
    @Body() body: { whitelist: Array<{ datasetId: string; dsKey: string }>; query: string; topK?: number },
  ) {
    return this.resources.retrieveByWhitelist(body.whitelist, body.query, body.topK ?? 5);
  }

  // ===== Dataset 全链路（FR-009 平台⇄Dify）=====

  /** ① 同步 Dify Dataset 列表 */
  @Get('datasets')
  async syncDatasets() {
    const datasets = await this.client.listDatasets();
    return { total: datasets.length, datasets };
  }

  /** ② 平台 API 创建知识库（economy 免模型） */
  @Post('datasets')
  async createDataset(@Body() body: { name: string; indexingTechnique?: 'high_quality' | 'economy' }) {
    const id = await this.client.createDataset('', body.name, body.indexingTechnique ?? 'economy');
    return { datasetId: id, nextStep: 'upload-document' };
  }

  /** ③+④ 上传文件并创建文档（一步到位） */
  @Post('datasets/:datasetId/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('datasetId') datasetId: string,
    @Query('name') name: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    if (!file) throw new Error('40001: 缺少文件（form-data 字段名 file）');
    const fileId = await this.client.uploadFile('', file.buffer, file.originalname);
    const doc = await this.client.createDocument('', datasetId, fileId, name ?? file.originalname);
    return { fileId, ...doc };
  }

  /** ⑤ 文档索引状态 */
  @Get('datasets/:datasetId/documents')
  async documentStatus(@Param('datasetId') datasetId: string) {
    return this.client.getDocumentStatus('', datasetId);
  }

  /** ⑥ App 执行（chat）——同机器人动态知识入口 */
  @Post('apps/:appId/run')
  async runApp(@Param('appId') appId: string, @Body() body: { apiKey: string; query: string; conversationId?: string }) {
    if (!body.apiKey || !body.query) {
      throw new HttpException({ code: 40001, message: 'apiKey/query 必填', data: null }, HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.client.runChat(body.apiKey, body.query, body.conversationId);
    } catch (e) {
      // Dify 业务错误（Key 无效/App 不存在/实例不可达）→ 可读业务响应而非 500
      throw new HttpException({ code: 40001, message: String(redactLogValue((e as Error).message)), data: null }, HttpStatus.BAD_REQUEST);
    }
  }
}
