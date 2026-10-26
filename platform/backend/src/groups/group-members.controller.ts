import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GroupMember } from './group-member.entity';
import { Group } from './group.entity';
import { User } from '../users/user.entity';
import { AuditService } from '../audit/audit.service';

/** 群成员（FR-005）：成员列表 + 群内角色覆盖（BR-007） */
@Controller('api/v1/tenant/groups/:groupId/members')
export class GroupMembersController {
  constructor(
    @InjectRepository(GroupMember) private readonly repo: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  /** 群成员列表（关联平台用户：昵称/身份/脱敏手机号/权限角色，groups.html 成员 8 列数据源） */
  @Get()
  async list(@Param('groupId') groupId: string, @Query('tenantId') tenantId: string): Promise<Array<GroupMember & { name?: string; identity?: string; phoneMasked?: string; role?: string }>> {
    if (!await this.groups.findOne({ where: { id: groupId, tenantId } })) throw new Error('40401: 群不存在');
    const members = await this.repo.find({ where: { groupId } });
    const userIds = members.map((m) => m.userId).filter((x): x is string => !!x);
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const uMap = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => {
      const u = m.userId ? uMap.get(m.userId) : undefined;
      return { ...m, name: u?.name, identity: u?.identity, phoneMasked: u?.phoneMasked, role: u?.role };
    });
  }

  /** 设置群内角色（跟随默认=null 清除覆盖）——BR-007 */
  @Put(':channelUserId/role')
  async setRole(
    @Param('groupId') groupId: string,
    @Param('channelUserId') channelUserId: string,
    @Query('tenantId') tenantId: string,
    @Body() body: { role?: string | null },
  ): Promise<GroupMember> {
    const tenantGroup = await this.groups.findOne({ where: { id: groupId, tenantId } });
    if (!tenantGroup) throw new Error('40401: 群不存在');
    let member = await this.repo.findOne({ where: { groupId, channelUserId } });
    if (!member) {
      member = this.repo.create({ groupId, channelUserId, source: 'wecom' });
    }
    const prev = member.groupRoleOverride ?? null;
    member.groupRoleOverride = body.role ?? null;
    const saved = await this.repo.save(member);
    if (prev !== (body.role ?? null)) {
      await this.audit.log({
        tenantId: tenantGroup.tenantId, question: `[群] 群内角色设置（${tenantGroup.name ?? groupId.slice(0, 8)}…）`,
        result: `${channelUserId.slice(0, 12)}… 角色 ${prev ?? '跟随默认'} → ${body.role ?? '跟随默认'}`,
      }).catch(() => undefined);
    }
    return saved;
  }

  /** 加入群（enter_chat 成员事件） */
  @Put(':channelUserId')
  async join(
    @Param('groupId') groupId: string,
    @Param('channelUserId') channelUserId: string,
    @Query('tenantId') tenantId: string,
    @Body() body: { source?: 'wecom' | 'wx_customer' | 'dingtalk' | 'feishu' },
  ): Promise<GroupMember> {
    if (!await this.groups.findOne({ where: { id: groupId, tenantId } })) throw new Error('40401: 群不存在');
    let member = await this.repo.findOne({ where: { groupId, channelUserId } });
    if (!member) {
      member = this.repo.create({ groupId, channelUserId, source: body.source ?? 'wecom' });
      await this.repo.save(member);
    }
    return member;
  }
}
