import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../notifications/notification.entity';

/** 平台通知中心（对齐原型 platform-notifications.html）：平台维度系统事件 */
@Controller('api/v1/platform/notifications')
export class PlatformNotificationsController {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
  ) {}

  /** 平台通知列表（全租户 + 平台级事件，未读优先） */
  @Get()
  list(@Query('limit') limit = 50): Promise<Notification[]> {
    return this.repo.find({ order: { isRead: 'ASC', createdAt: 'DESC' }, take: Number(limit) });
  }

  @Get('unread-count')
  async unread() {
    return { count: await this.repo.count({ where: { isRead: false } }) };
  }

  @Patch(':id/read')
  markRead(@Query('id') id: string) {
    return this.repo.update(id, { isRead: true });
  }

  @Patch('read-all')
  markAllRead() {
    return this.repo.update({ isRead: false }, { isRead: true });
  }

  /** 平台事件通知（租户生命周期/异常等触发） */
  @Post()
  async create(@Body() body: { type: string; title: string; content: string; link?: string; tenantId?: string }) {
    return this.repo.save(this.repo.create({
      type: body.type,
      title: body.title,
      content: body.content,
      link: body.link,
      tenantId: body.tenantId ?? 'platform',
    }));
  }
}
