import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';

/** 消息群发（FR-017）：/api/v1/tenant/broadcast */
@Controller('api/v1/tenant/broadcast')
export class BroadcastController {
  constructor(private readonly broadcast: BroadcastService) {}

  /** 群候选（多选机器人 → 绑定群并集） */
  @Get('groups')
  groups(@Query('tenantId') tenantId: string, @Query('robotIds') robotIds: string) {
    return this.broadcast.listCandidateGroups(tenantId, robotIds.split(','));
  }

  /** 发送（返回 {record, attempts, failedGroups}） */
  @Post()
  send(@Body() body: {
    tenantId: string;
    robotIds: string[];
    groupIds: string[];
    content: string;
    images?: string[];
    operator?: string;
    pollIntervalMinutes?: number;
    pollCount?: number;
  }) {
    return this.broadcast.send(body);
  }

  /** 发送记录 */
  @Get()
  list(@Query('tenantId') tenantId: string) {
    return this.broadcast.list(tenantId);
  }

  /** 重试失败群 */
  @Post(':id/retry')
  retry(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.broadcast.retry(id, tenantId);
  }
}
