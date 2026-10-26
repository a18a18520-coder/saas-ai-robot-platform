import { ConflictException, Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { PlatformToolsService } from './platform-tools.service';
import { Tool } from './tool.entity';
import { LifecycleVerifyDto } from '../common/lifecycle/verify.dto';

/** 租户侧外部接口（对齐原型 tools.html + tool-config.html）：查看/自建/配置/停用/删除工具 */
@Controller('api/v1/tenant/tools')
export class TenantToolsController {
  constructor(private readonly tools: PlatformToolsService) {}

  /** 正反向验证校验（BR-011，与平台侧一致） */
  private assertVerify(verify?: LifecycleVerifyDto) {
    if (!verify?.positive || !verify?.negative) {
      throw new HttpException({ code: 42201, message: '正反向验证必填（positive/negative）', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  /** 工具列表（本租户） */
  @Get()
  list(@Query('tenantId') tenantId: string): Promise<Tool[]> {
    if (!tenantId) throw new HttpException({ code: 40001, message: '参数缺失: tenantId', data: null }, HttpStatus.BAD_REQUEST);
    return this.tools.list(tenantId);
  }

  /** 工具详情（配置页加载：含请求参数 schema / 返回白名单） */
  @Get(':id')
  detail(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Tool> {
    return this.tools.findOne(id, tenantId);
  }

  /** 租户自建工具 */
  @Post()
  create(@Body() body: Partial<Tool>): Promise<Tool> {
    if (!body.name || !body.identifier || !body.url) {
      throw new HttpException({ code: 40001, message: 'name/identifier/url 必填', data: null }, HttpStatus.BAD_REQUEST);
    }
    return this.tools.createForTenant(body);
  }

  /** 保存工具配置（请求参数传值 / 返回白名单输出 / 认证 / 访问角色 —— tool-config 原型） */
  @Put(':id')
  update(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: Partial<Tool>): Promise<Tool> {
    if (!body.configRevision) throw new ConflictException('配置页面版本已过期，请刷新页面后重新打开工具配置。');
    return this.tools.update(id, body, tenantId);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { verify?: LifecycleVerifyDto }): Promise<Tool> {
    this.assertVerify(body?.verify);
    return this.tools.setActive(id, false, tenantId);
  }

  @Post(':id/enable')
  enable(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Tool> {
    return this.tools.setActive(id, true, tenantId);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { arguments: Record<string, unknown> }) {
    if (!tenantId) throw new HttpException('tenantId 必填', HttpStatus.BAD_REQUEST);
    return this.tools.test(id, body.arguments, tenantId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { verify?: LifecycleVerifyDto }) {
    this.assertVerify(body?.verify);
    return this.tools.remove(id, tenantId);
  }
}
