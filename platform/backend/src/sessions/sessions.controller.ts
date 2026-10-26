import { Controller, Get, Param, Query, NotFoundException, BadRequestException, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation, Message } from './conversation.entity';

/** 会话管理（FR-014）：五层模型查询，群内按 user 隔离 */
@Controller('api/v1/tenant/sessions')
export class SessionsController {
  constructor(
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
  ) {}

  /** 会话列表（按租户，可选群/用户筛选） */
  @Get()
  async list(@Query('tenantId') tenantId: string, @Query('groupId') groupId?: string, @Query('page') page?: string, @Query('pageSize') pageSize = '50') {
    const p = Number(page ?? '1'), size = Number(pageSize);
    if (!Number.isInteger(p) || p < 1 || p > 100000 || !Number.isInteger(size) || size < 1 || size > 100) throw new BadRequestException('会话分页参数无效');
    const where: Record<string, unknown> = { tenantId };
    if (groupId) where.groupId = groupId;
    const [convs, total] = await this.convs.findAndCount({ where, order: { updatedAt: 'DESC', id: 'DESC' }, take: size, skip: (p - 1) * size });
    const withCount = await Promise.all(
      convs.map(async (c) => ({
        ...c,
        messageCount: await this.messages.count({ where: { conversationId: c.id } }),
      })),
    );
    return page === undefined ? withCount : { items: withCount, total, page: p, pageSize: size };
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!await this.convs.findOne({ where: { id, tenantId } })) throw new NotFoundException('会话不存在');
    await this.convs.update({ id, tenantId }, { endedAt: new Date() });
    return { ok: true };
  }

  /** 会话详情（消息记录） */
  @Get(':id/messages')
  async messagesOf(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Message[]> {
    if (!await this.convs.findOne({ where: { id, tenantId } })) throw new NotFoundException('会话不存在');
    return this.messages.find({ where: { conversationId: id }, order: { createdAt: 'ASC' } });
  }
}
