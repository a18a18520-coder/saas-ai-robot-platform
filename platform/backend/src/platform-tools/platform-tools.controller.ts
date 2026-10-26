import { ConflictException, Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { PlatformToolsService } from './platform-tools.service';
import { Tool } from './tool.entity';
import { LifecycleVerifyDto } from '../common/lifecycle/verify.dto';
import { AuditService } from '../audit/audit.service';

/** 平台侧工具管理 API（FR-025）——真实落库，对应 04 原型 platform-tools.html */
@Controller('api/v1/admin/tools')
export class PlatformToolsController {
  constructor(
    private readonly tools: PlatformToolsService,
    private readonly audit: AuditService,
  ) {}

  /** 全租户工具列表（含所属租户，按租户筛选） */
  @Get()
  list(@Query('tenantId') tenantId?: string): Promise<Tool[]> {
    return this.tools.list(tenantId);
  }

  /** 工具详情（配置页加载） */
  @Get(':id')
  detail(@Param('id') id: string): Promise<Tool> {
    return this.tools.findOne(id);
  }

  /** 平台侧为租户新增工具（归属租户选择，自动落库） */
  @Post(':id/test')
  test(@Param('id') id: string, @Body() body: { arguments: Record<string, unknown> }) {
    return this.tools.test(id, body.arguments);
  }

  @Post()
  async createForTenant(@Body() body: Partial<Tool>): Promise<Tool> {
    if (!body.tenantId || !body.name || !body.identifier || !body.url) {
      throw new HttpException({ code: 40001, message: 'tenantId/name/identifier/url 必填', data: null }, HttpStatus.BAD_REQUEST);
    }
    const tool = await this.tools.createForTenant(body);
    await this.audit.log({
      tenantId: body.tenantId, question: `[工具] 平台新增（${tool.name}）`,
      result: `${tool.identifier} · ${tool.method} ${tool.url.slice(0, 40)}${tool.authType !== 'NONE' ? ` · ${tool.authType}` : ' · 无认证'}`,
    }).catch(() => undefined);
    return tool;
  }

  /** 平台侧编辑工具配置（请求参数/返回白名单/认证/角色） */
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Partial<Tool>): Promise<Tool> {
    if (!body.configRevision) throw new ConflictException('配置页面版本已过期，请刷新页面后重新打开工具配置。');
    const tool = await this.tools.update(id, body);
    await this.audit.log({
      tenantId: tool.tenantId, question: `[工具] 配置更新（${tool.name}）`,
      result: `传值参数 ${Object.keys(body.requestSchema ?? {}).length} 个 · 输出白名单 ${(body.responseWhitelist ?? []).length} 字段`,
    }).catch(() => undefined);
    return tool;
  }

  /** 工具生命周期（禁用/删除 + 正反向验证） */
  @Post(':id/disable')
  async disable(@Param('id') id: string, @Body() body: { verify: LifecycleVerifyDto }) {
    if (!body.verify?.positive || !body.verify?.negative) {
      throw new HttpException({ code: 42201, message: '正反向验证必填', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const tool = await this.tools.setActive(id, false);
    await this.audit.log({
      tenantId: tool.tenantId, question: `[工具] 停用（${tool.name}）`,
      result: '机器人将无法调用此接口',
    }).catch(() => undefined);
    return tool;
  }

  @Post(':id/enable')
  async enable(@Param('id') id: string): Promise<Tool> {
    const tool = await this.tools.setActive(id, true);
    await this.audit.log({
      tenantId: tool.tenantId, question: `[工具] 启用（${tool.name}）`,
      result: '恢复机器人调用能力',
    }).catch(() => undefined);
    return tool;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Body() body: { verify: LifecycleVerifyDto }) {
    if (!body.verify?.positive || !body.verify?.negative) {
      throw new HttpException({ code: 42201, message: '正反向验证必填', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const tool = await this.tools.findOne(id);
    const r = await this.tools.remove(id);
    await this.audit.log({
      tenantId: tool?.tenantId ?? 'platform', question: `[工具] 删除（${tool?.name ?? id.slice(0, 8)}）`,
      result: r.cascade,
    }).catch(() => undefined);
    return r;
  }
}
