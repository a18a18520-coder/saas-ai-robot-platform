import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Group } from './group.entity';

/** 仅供已验签/已鉴权的渠道回调调用，负责幂等登记真实群。 */
@Injectable()
export class GroupRegistrationService {
  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly audit: AuditService,
  ) {}

  async register(params: { tenantId: string; channel: string; chatId: string; name?: string; groupType?: 'internal' | 'customer' }): Promise<Group> {
    const existing = await this.groups.findOne({ where: { tenantId: params.tenantId, channel: params.channel, chatId: params.chatId } });
    if (existing) {
      if (params.name && !existing.name) {
        existing.name = params.name;
        return this.groups.save(existing);
      }
      return existing;
    }
    const group = await this.groups.save(this.groups.create({
      tenantId: params.tenantId,
      channel: params.channel,
      chatId: params.chatId,
      name: params.name,
      groupType: params.groupType ?? 'internal',
      status: 'PENDING',
    }));
    await this.audit.log({
      tenantId: params.tenantId,
      question: `[群] 渠道回调自动注册（${params.channel}/${params.chatId.slice(0, 10)}…）`,
      result: 'PENDING 待绑定机器人',
      channelUserId: 'system',
    }).catch(() => undefined);
    return group;
  }
}
