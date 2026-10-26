import { BadRequestException, Body, Controller, Param, Post, Query, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { Channel } from './channel.entity';
import { Group } from '../groups/group.entity';
import { DingTalkService } from './dingtalk.service';
import { AuthPayload } from '../auth/auth.service';
import { Conversation, Message } from '../sessions/conversation.entity';

@Controller('api/v1/tenant/follow-ups')
export class FollowUpReplyController {
  constructor(@InjectRepository(FollowUp) private readonly repo: Repository<FollowUp>, private readonly ding: DingTalkService) {}

  @Post(':id/reply-confirmation')
  async confirm(@Query('tenantId') tenantId: string, @Param('id') id: string, @Req() req: { auth: AuthPayload }, @Body() body: { received: boolean }) {
    if (typeof body.received !== 'boolean') throw new BadRequestException('请核对原群是否收到回复');
    return this.repo.manager.transaction(async manager => {
      const row = await manager.findOne(FollowUp, { where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!row || !['sending', 'uncertain'].includes(row.delivery?.state ?? '')) throw new BadRequestException('该记录无需核对');
      if (row.delivery.state === 'sending') {
        const started = new Date(row.delivery.startedAt ?? row.updatedAt).getTime();
        if (!Number.isFinite(started) || Date.now() - started < 5 * 60 * 1000) throw new BadRequestException('发送仍在处理中，请在五分钟后核对原群结果');
      }
      if (body.received && row.delivery.conversationId && row.resolution?.answer) {
        const conversation = await manager.findOne(Conversation, { where: { id: row.delivery.conversationId, tenantId, robotId: row.robotId } });
        if (conversation) await manager.save(Message, manager.create(Message, {
          conversationId: conversation.id, role: 'human', content: row.resolution.answer,
          metadata: { followUpId: id, actorId: req.auth.sub, channel: 'dingtalk', sent: true, manuallyConfirmed: true },
        }));
      }
      row.delivery = { ...row.delivery, attemptId: randomUUID(), state: body.received ? 'sent' : 'failed', actorId: req.auth.sub, error: body.received ? undefined : '人工核对原群未收到，可重试', sentAt: body.received ? new Date().toISOString() : undefined };
      return manager.save(row);
    });
  }

  @Post(':id/reply')
  async reply(@Query('tenantId') tenantId: string, @Param('id') id: string, @Req() req: { auth: AuthPayload }) {
    const item = await this.repo.manager.transaction(async manager => {
      const row = await manager.findOne(FollowUp, { where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.channel !== 'dingtalk' || !row.chatId || !row.delivery?.channelId || !row.resolution?.answer) throw new BadRequestException('缺少原群渠道或已保存的回答，无法发送');
      const hash = createHash('sha256').update(row.resolution.answer).digest('hex');
      if (row.delivery.state === 'sent' && row.delivery.answerHash === hash) return null;
      if (['sending', 'uncertain'].includes(row.delivery.state ?? '')) throw new BadRequestException('发送结果待核对，请先核对群消息，避免重复回复');
      const channel = await manager.findOne(Channel, { where: { id: row.delivery.channelId, tenantId, type: 'dingtalk', isActive: true } });
      const group = await manager.findOne(Group, { where: { tenantId, chatId: row.chatId, channel: 'dingtalk', status: 'BOUND' } });
      if (!channel || !group || group.robotId !== row.robotId) throw new BadRequestException('原渠道已停用或群机器人绑定已变更');
      row.delivery = { ...row.delivery, state: 'sending', attemptId: randomUUID(), startedAt: new Date().toISOString(), answerHash: hash, actorId: req.auth.sub, error: undefined };
      return manager.save(row);
    });
    if (!item) return { sent: true, duplicate: true };
    let sent = false;
    try { sent = await this.ding.sendToGroup(item.delivery.channelId!, tenantId, item.chatId!, '关于「' + item.question.slice(0, 200) + '」\n客服回复：\n' + item.resolution.answer); }
    catch {
      await this.repo.manager.transaction(async manager => {
        const current = await manager.findOne(FollowUp, { where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
        if (current?.delivery?.attemptId === item.delivery.attemptId && current.delivery.state === 'sending') {
          current.delivery = { ...current.delivery, state: 'uncertain', error: '发送结果不确定，请核对原群消息' };
          await manager.save(current);
        }
      });
      throw new BadRequestException('回答已保存，发送结果不确定，请核对原群消息');
    }
    await this.repo.manager.transaction(async manager => {
      const current = await manager.findOne(FollowUp, { where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (current?.delivery?.attemptId !== item.delivery.attemptId || current.delivery.state !== 'sending') return;
      await manager.update(FollowUp, { id, tenantId }, { delivery: { ...item.delivery, state: sent ? 'sent' : 'failed', sentAt: sent ? new Date().toISOString() : undefined, error: sent ? undefined : '渠道未确认发送成功' } });
      if (sent && item.delivery.conversationId) {
        const conversation = await manager.findOne(Conversation, { where: { id: item.delivery.conversationId, tenantId, robotId: item.robotId } });
        if (conversation) await manager.save(Message, manager.create(Message, { conversationId: conversation.id, role: 'human', content: item.resolution.answer, metadata: { followUpId: id, actorId: req.auth.sub, channel: 'dingtalk', sent: true } }));
      }
    });
    if (!sent) throw new BadRequestException('回答已保存，原群发送失败，请检查渠道后重试');
    return { sent: true };
  }
}
