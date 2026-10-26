import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AuthPayload } from '../auth/auth.service';
import { FollowUpsService } from './follow-ups.service';

/** 待跟进队列 API（FR-016）：运营查看/关闭未命中问题 */
@Controller('api/v1/tenant/follow-ups')
export class FollowUpsController {
  constructor(private readonly service: FollowUpsService) {}

  @Get(':id/knowledge-targets')
  targets(@Query('tenantId') t: string, @Param('id') id: string) { return this.service.targets(t, id); }

  @Post(':id/answer')
  answer(@Query('tenantId') t: string, @Param('id') id: string, @Req() req: { auth: AuthPayload }, @Body() body: { answer: string; note?: string; saveToKnowledge: boolean; datasetId?: string; secLevel?: number }) {
    if (body.saveToKnowledge && !req.auth.windows?.includes('knowledge')) throw new ForbiddenException('存入知识库需要知识库管理权限');
    return this.service.answer(t, id, req.auth.sub, body);
  }

  /** 列表（?tenantId=xxx&status=pending） */
  @Get()
  list(@Query('tenantId') tenantId: string, @Query('status') status?: string) {
    if (!tenantId) return { code: 40001, message: '参数缺失: tenantId', data: null };
    return this.service.list(tenantId, status);
  }

  /** 关闭（标记已跟进） */
  @Post(':id/close')
  async close(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { note?: string }) {
    const item = await this.service.close(id, tenantId, body?.note);
    if (!item) return { code: 40401, message: '待跟进记录不存在', data: null };
    return { code: 0, message: 'success', data: item };
  }
}
