import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';

/** 通知中心（FR-027） */
@Controller('api/v1/tenant/notifications')
export class NotificationsController {
  constructor(@InjectRepository(Notification) private readonly repo: Repository<Notification>) {}

  @Get()
  list(@Query('tenantId') tenantId: string): Promise<Notification[]> {
    // 未读优先（对齐原型：未读置顶）
    return this.repo.find({ where: { tenantId }, order: { isRead: 'ASC', createdAt: 'DESC' }, take: 50 });
  }

  @Get('unread-count')
  async unread(@Query('tenantId') tenantId: string) {
    return { count: await this.repo.count({ where: { tenantId, isRead: false } }) };
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.repo.update({ id, tenantId }, { isRead: true });
  }

  @Patch('read-all')
  markAllRead(@Body() body: { tenantId: string }) {
    return this.repo.update({ tenantId: body.tenantId, isRead: false }, { isRead: true });
  }

  /** 创建通知（内部服务调用） */
  async create(notification: Partial<Notification>): Promise<Notification> {
    return this.repo.save(this.repo.create(notification));
  }
}
