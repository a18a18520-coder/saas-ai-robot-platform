import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { BroadcastRecord } from './broadcast-record.entity';
import { Group } from '../groups/group.entity';
import { Channel } from '../channels/channel.entity';
import { WeComService } from '../channels/wecom.service';
import { DingTalkService } from '../channels/dingtalk.service';
import { FeishuService } from '../channels/feishu.service';
import { AuditService } from '../audit/audit.service';
import { Notification } from '../notifications/notification.entity';

/**
 * 消息群发（FR-017）：
 * 多选机器人 → 群并集（已绑定群）→ 内容 → 逐群真实发送 → 记录/重试
 * 按群来源渠道分发：企微 appchat/send、钉钉 groupMessages/send、飞书 im.message.create
 */
@Injectable()
export class BroadcastService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcastService.name);
  private scheduler?: ReturnType<typeof setInterval>;
  private dispatching = false;

  static readonly MAX_ATTEMPTS = 3; // 失败自动重试 3 次
  static readonly MIN_POLL_INTERVAL_MINUTES = 1;
  static readonly MAX_POLL_INTERVAL_MINUTES = 1440;
  static readonly MAX_POLL_COUNT = 100;
  static readonly SCHEDULER_INTERVAL_MS = 30_000;

  constructor(
    @InjectRepository(BroadcastRecord) private readonly records: Repository<BroadcastRecord>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly audit: AuditService,
    private readonly wecom: WeComService,
    private readonly dingtalk: DingTalkService,
    private readonly feishu: FeishuService,
  ) {}

  onModuleInit(): void {
    if (process.env.BROADCAST_SCHEDULER_ENABLED === 'false') return;
    void this.recoverInterrupted().then(() => this.dispatchDue()).catch((error) => {
      this.logger.error(`恢复消息轮询计划失败: ${(error as Error).message}`);
    });
    this.scheduler = setInterval(() => {
      void this.dispatchDue().catch((error) => this.logger.error(`执行消息轮询计划失败: ${(error as Error).message}`));
    }, BroadcastService.SCHEDULER_INTERVAL_MS);
    this.scheduler.unref?.();
  }

  onModuleDestroy(): void {
    if (this.scheduler) clearInterval(this.scheduler);
  }

  /** 群发送候选（多选机器人 → 绑定群并集，一群一机器人） */
  async listCandidateGroups(tenantId: string, robotIds: string[]): Promise<Group[]> {
    return this.groups.find({ where: { tenantId, status: 'BOUND', robotId: In(robotIds) } });
  }

  /** 创建发送计划：首轮立即执行，后续轮次由数据库计划恢复执行。 */
  async send(params: {
    tenantId: string;
    robotIds: string[];
    groupIds: string[];
    content: string;
    images?: string[];
    operator?: string;
    pollIntervalMinutes?: number;
    pollCount?: number;
  }): Promise<{ record: BroadcastRecord; attempts: Record<string, number>; failedGroups: string[] }> {
    const input = this.validateSendParams(params);
    const record = await this.records.save(this.records.create({
      tenantId: input.tenantId,
      robotIds: input.robotIds,
      groupIds: input.groupIds,
      content: input.content,
      images: input.images,
      status: 'SENDING',
      operator: input.operator,
      pollIntervalMinutes: input.pollIntervalMinutes,
      pollCount: input.pollCount,
      completedPolls: 0,
      nextPollAt: null,
      roundResults: [],
      updatedAt: new Date(),
    }));

    const result = await this.executeRound(record);
    return { record: result.record, attempts: result.attempts, failedGroups: result.failedGroups };
  }

  /** 执行一轮逐群发送；每群内部失败自动重试三次。 */
  private async executeRound(record: BroadcastRecord): Promise<{ record: BroadcastRecord; attempts: Record<string, number>; failedGroups: string[] }> {
    // 逐群发送：按群来源渠道真实发送，失败自动重试 3 次（带间隔），仍失败 → 人工介入提醒
    const groupMap = new Map((await this.groups.find({ where: { tenantId: record.tenantId, chatId: In(record.groupIds) } })).map((g) => [g.chatId, g]));
    const results: Record<string, string> = {};
    const attempts: Record<string, number> = {};
    let success = 0;
    const failedGroups: string[] = [];

    for (const chatId of record.groupIds) {
      const group = groupMap.get(chatId);
      let ok = false;
      let attempt = 0;
      while (!ok && attempt < BroadcastService.MAX_ATTEMPTS) {
        attempt++;
        try {
          ok = await this.sendToGroup(group, record.content);
        } catch (e) {
          this.logger.warn(`群发异常 ${chatId}: ${(e as Error).message}`);
          ok = false;
        }
        if (!ok && attempt < BroadcastService.MAX_ATTEMPTS) await this.delay(500 * attempt); // 退避间隔
      }
      attempts[chatId] = attempt;
      results[chatId] = ok ? 'ok' : 'error';
      if (ok) success++; else failedGroups.push(chatId);
    }

    const sentAt = new Date();
    const round = (record.completedPolls ?? 0) + 1;
    record.results = results;
    record.completedPolls = round;
    record.lastSentAt = sentAt;
    record.updatedAt = sentAt;
    record.roundResults = [...(record.roundResults ?? []), { round, sentAt: sentAt.toISOString(), results, attempts }];
    const completed = round >= record.pollCount;
    record.status = completed
      ? success === record.groupIds.length ? 'SUCCESS' : success === 0 ? 'FAILED' : 'PARTIAL'
      : 'SCHEDULED';
    record.nextPollAt = completed ? null : new Date(sentAt.getTime() + record.pollIntervalMinutes * 60_000);
    await this.records.save(record);

    // 最后一轮仍失败时再提醒人工介入；中间轮次可由下一轮自动恢复。
    if (completed && failedGroups.length) {
      await this.notifications.save(this.notifications.create({
        tenantId: record.tenantId,
        type: 'broadcast_failed',
        title: `群发部分失败（${failedGroups.length}/${record.groupIds.length}）`,
        content: `群 ${failedGroups.join(', ')} 重试 ${BroadcastService.MAX_ATTEMPTS} 次仍失败，需人工介入处理`,
        link: '/t/broadcast',
      })).catch((error) => this.logger.warn(`创建群发失败通知失败: ${(error as Error).message}`));
    }

    await this.audit.log({
      tenantId: record.tenantId,
      question: `[群发 ${round}/${record.pollCount}] ${record.content.slice(0, 50)}`,
      result: completed ? record.status === 'SUCCESS' ? '群发成功' : '群发部分失败' : '等待下一轮',
      answer: `目标 ${record.groupIds.length} 群，本轮成功 ${success}，单群最多尝试 ${BroadcastService.MAX_ATTEMPTS} 次`,
    }).catch((error) => this.logger.warn(`记录群发审计失败: ${(error as Error).message}`));
    return { record, attempts, failedGroups };
  }

  /** 发送记录列表（中断恢复后附群渠道供前端展示）。 */
  async list(tenantId: string): Promise<BroadcastRecord[]> {
    await this.recoverInterrupted(tenantId);
    void this.dispatchDue(tenantId).catch((error) => this.logger.warn(`执行租户消息计划失败: ${(error as Error).message}`));
    const records = await this.records.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: 50 });
    // 群渠道映射（前端展示逐群结果按哪个渠道发送；对象而非 Map —— Map 无法 JSON 序列化）
    const chMap: Record<string, string> = {};
    for (const g of await this.groups.find({ where: { tenantId } })) chMap[g.chatId] = g.channel;
    return records.map((r) => ({ ...r, groupChannels: chMap }));
  }

  /** 重试失败群（真实发送） */
  async retry(id: string, tenantId: string): Promise<BroadcastRecord> {
    const record = await this.records.findOne({ where: { id, tenantId } });
    if (!record) throw new Error('40401: 记录不存在');
    if (['PENDING', 'SENDING', 'SCHEDULED'].includes(record.status)) throw new ConflictException('轮询发送计划尚未结束，暂不能手动重试');
    const failed = Object.entries(record.results ?? {}).filter(([, v]) => v === 'error').map(([k]) => k);
    if (!failed.length) return record;
    const groupMap = new Map((await this.groups.find({ where: { tenantId, chatId: In(failed) } })).map((g) => [g.chatId, g]));
    const results = { ...record.results };
    for (const chatId of failed) {
      const ok = await this.sendToGroup(groupMap.get(chatId), record.content);
      results[chatId] = ok ? 'ok' : 'error';
    }
    record.results = results;
    const totalSuccess = Object.values(results).filter((value) => value === 'ok').length;
    record.status = totalSuccess === record.groupIds.length ? 'SUCCESS' : totalSuccess === 0 ? 'FAILED' : 'PARTIAL';
    record.lastSentAt = new Date();
    record.updatedAt = record.lastSentAt;
    return this.records.save(record);
  }

  /** 原子领取到期计划，确保多实例部署时同一轮只由一个实例执行。 */
  async dispatchDue(tenantId?: string): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const where = tenantId
        ? { tenantId, status: 'SCHEDULED' as const, nextPollAt: LessThanOrEqual(new Date()) }
        : { status: 'SCHEDULED' as const, nextPollAt: LessThanOrEqual(new Date()) };
      const due = await this.records.find({ where, order: { nextPollAt: 'ASC' }, take: 20 });
      for (const record of due) {
        const claimed = await this.records.update(
          { id: record.id, status: 'SCHEDULED' },
          { status: 'SENDING', updatedAt: new Date() },
        );
        if (claimed.affected !== 1) continue;
        record.status = 'SENDING';
        await this.executeRound(record).catch(async (error) => {
          this.logger.error(`消息计划 ${record.id} 执行失败: ${(error as Error).message}`);
          record.status = 'SCHEDULED';
          record.nextPollAt = new Date(Date.now() + Math.max(1, record.pollIntervalMinutes) * 60_000);
          record.updatedAt = new Date();
          await this.records.save(record);
        });
      }
    } finally {
      this.dispatching = false;
    }
  }

  /** 进程中断后的 SENDING 计划回到待执行状态，下一次调度会继续。 */
  private async recoverInterrupted(tenantId?: string): Promise<void> {
    const stale = await this.records.find({ where: tenantId ? { tenantId, status: 'SENDING' } : { status: 'SENDING' } });
    const cutoff = Date.now() - 10 * 60_000;
    for (const record of stale) {
      const updatedAt = new Date(record.updatedAt ?? record.createdAt).getTime();
      if (updatedAt > cutoff) continue;
      record.status = (record.completedPolls ?? 0) < (record.pollCount ?? 1) ? 'SCHEDULED' : this.statusFromResults(record);
      record.nextPollAt = record.status === 'SCHEDULED' ? new Date() : null;
      record.updatedAt = new Date();
      await this.records.save(record);
    }
  }

  private statusFromResults(record: BroadcastRecord): 'SUCCESS' | 'PARTIAL' | 'FAILED' {
    const values = Object.values(record.results ?? {});
    const success = values.filter((value) => value === 'ok').length;
    return success === record.groupIds.length ? 'SUCCESS' : success === 0 ? 'FAILED' : 'PARTIAL';
  }

  private validateSendParams(params: {
    tenantId: string;
    robotIds: string[];
    groupIds: string[];
    content: string;
    images?: string[];
    operator?: string;
    pollIntervalMinutes?: number;
    pollCount?: number;
  }) {
    const tenantId = String(params.tenantId ?? '').trim();
    const robotIds = [...new Set((params.robotIds ?? []).map(String).filter(Boolean))];
    const groupIds = [...new Set((params.groupIds ?? []).map(String).filter(Boolean))];
    const content = typeof params.content === 'string' ? params.content.trim() : '';
    const images = Array.isArray(params.images) ? params.images.slice(0, 3) : [];
    const pollCount = Number(params.pollCount ?? 1);
    if (!tenantId || !robotIds.length || !groupIds.length) throw new BadRequestException('租户、机器人和目标群均为必填项');
    if (!content && !images.length) throw new BadRequestException('请输入消息内容或插入图片');
    if (content.length > 4000) throw new BadRequestException('消息内容不能超过 4000 个字符');
    if (!Number.isInteger(pollCount) || pollCount < 1 || pollCount > BroadcastService.MAX_POLL_COUNT) {
      throw new BadRequestException(`轮询次数须为 1-${BroadcastService.MAX_POLL_COUNT} 的整数`);
    }
    const pollIntervalMinutes = pollCount === 1 ? 5 : Number(params.pollIntervalMinutes ?? 5);
    if (!Number.isInteger(pollIntervalMinutes) || pollIntervalMinutes < BroadcastService.MIN_POLL_INTERVAL_MINUTES || pollIntervalMinutes > BroadcastService.MAX_POLL_INTERVAL_MINUTES) {
      throw new BadRequestException(`轮询间隔须为 ${BroadcastService.MIN_POLL_INTERVAL_MINUTES}-${BroadcastService.MAX_POLL_INTERVAL_MINUTES} 分钟的整数`);
    }
    return { ...params, tenantId, robotIds, groupIds, content, images, pollIntervalMinutes, pollCount };
  }

  /** 真实渠道发送：按群来源渠道分发，凭据按绑定机器人匹配渠道（找不到渠道诚实失败，不造假） */
  private async sendToGroup(group: Group | undefined, content: string): Promise<boolean> {
    if (!group) {
      this.logger.warn(`群发失败: 群不存在`);
      return false;
    }
    const type = group.channel as 'wecom' | 'dingtalk' | 'feishu';
    if (!['wecom', 'dingtalk', 'feishu'].includes(type)) {
      this.logger.warn(`群发失败 ${group.chatId}: 渠道类型 ${type} 不支持群发`);
      return false;
    }
    // 渠道凭据：优先群绑定机器人对应的渠道，其次该类型第一个已连接渠道
    const channel = (group.robotId
      ? await this.channels.findOne({ where: { tenantId: group.tenantId, type, status: 'connected', bindRobotId: group.robotId } })
      : null) ?? await this.channels.findOne({ where: { tenantId: group.tenantId, type, status: 'connected' } });
    if (!channel) {
      this.logger.warn(`群发失败 ${group.chatId}: 未找到已连接的 ${type} 渠道（渠道接入页启用）`);
      return false;
    }
    this.logger.log(`[群发] ${group.chatId} 经 ${type} 渠道 ${channel.id.slice(0, 8)}…`);
    if (type === 'wecom') return this.wecom.sendToGroup(channel.id, group.tenantId, group.chatId, content);
    if (type === 'dingtalk') return this.dingtalk.sendToGroup(channel.id, group.tenantId, group.chatId, content);
    return this.feishu.sendExternal(channel.id, group.chatId, content);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
