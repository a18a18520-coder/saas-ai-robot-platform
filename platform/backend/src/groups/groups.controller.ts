import { BadRequestException, NotFoundException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { AuditService } from '../audit/audit.service';
import { Robot } from '../robots/robot.entity';

/** 群管理（FR-005）——机器人拉入自动注册（enter_chat）→ 绑定机器人 → @触发过滤 */
@Controller('api/v1/tenant/groups')
export class GroupsController {
  constructor(
    @InjectRepository(Group) private readonly repo: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    private readonly audit: AuditService,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
  ) {}

  private async requireRobot(tenantId: string, robotId: string) {
    if (typeof robotId !== 'string' || !robotId.trim()) throw new BadRequestException('请先绑定本租户的机器人');
    const robot = await this.robots.findOne({ where: { id: robotId, tenantId } });
    if (!robot || robot.status === 'DELETED') throw new BadRequestException('机器人不存在或不属于当前租户');
  }

  @Get()
  list(@Query('tenantId') tenantId: string): Promise<Group[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  /** 绑定机器人（一群一机器人） */
  @Post(':id/bind')
  async bind(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { robotId: string; handoffRole?: string }): Promise<Group | null> {
    const group = await this.repo.findOne({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('群不存在');
    await this.requireRobot(tenantId, body.robotId);
    group.robotId = body.robotId;
    group.handoffRole = body.handoffRole;
    group.status = 'BOUND';
    const saved = await this.repo.save(group);
    await this.audit.log({
      tenantId: group.tenantId, question: `[群] 绑定机器人（${saved.name ?? saved.chatId.slice(0, 10)}…）`,
      result: `robot=${body.robotId.slice(0, 8)}…${body.handoffRole ? ` · 转人工角色=${body.handoffRole}` : ''}`,
    }).catch(() => undefined);
    return saved;
  }

  /** @触发过滤判定（消息处理链路调用）：仅 @机器人 的消息消费 */
  @Post('should-process')
  async shouldProcess(@Query('tenantId') tenantId: string, @Body() body: { chatId: string; channel?: string; isAtRobot: boolean }): Promise<{ process: boolean; group?: Group }> {
    const group = await this.repo.findOne({ where: { tenantId, chatId: body.chatId, ...(body.channel ? { channel: body.channel } : {}) } });
    // 未绑定群不处理；未 @ 零消费
    if (!group || group.status !== 'BOUND' || !body.isAtRobot) return { process: false, group };
    return { process: true, group };
  }

  /** 编辑群（群名称/群类型，groups.html 行内「编辑」） */
  @Patch(':id')
  async update(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { name?: string; groupType?: 'internal' | 'customer' }): Promise<Group> {
    const group = await this.repo.findOne({ where: { id, tenantId } });
    if (!group) throw new Error('40401: 群不存在');
    if (body.name !== undefined) group.name = body.name;
    if (body.groupType !== undefined) group.groupType = body.groupType;
    const saved = await this.repo.save(group);
    await this.audit.log({
      tenantId: group.tenantId, question: `[群] 编辑群资料（${saved.name ?? saved.chatId.slice(0, 10)}…）`,
      result: `name=${saved.name ?? '-'} · type=${saved.groupType}`,
    }).catch(() => undefined);
    return saved;
  }

  /** 禁用/启用群（禁用后消息不再消费，群数据保留） */
  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { status: 'BOUND' | 'DISABLED' }): Promise<Group> {
    if (!['BOUND', 'DISABLED'].includes(body.status)) throw new BadRequestException('无效的群状态');
    const group = await this.repo.findOne({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('群不存在');
    if (body.status === 'BOUND') await this.requireRobot(tenantId, group.robotId!);
    group.status = body.status;
    const saved = await this.repo.save(group);
    await this.audit.log({
      tenantId: group.tenantId, question: `[群] ${body.status === 'DISABLED' ? '禁用' : '启用'}群（${saved.name ?? saved.chatId.slice(0, 10)}…）`,
      result: `status → ${body.status}（${body.status === 'DISABLED' ? '消息不再消费' : '恢复 @机器人 消费'}）`,
    }).catch(() => undefined);
    return saved;
  }

  /** 删除群（成员级联删除；已绑定群需先解绑，groups.html 行内「删除」） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<{ ok: boolean }> {
    const group = await this.repo.findOne({ where: { id, tenantId } });
    if (!group) throw new Error('40401: 群不存在');
    if (group.status === 'BOUND' && group.robotId) {
      throw new Error('42201: 群已绑定机器人，请先解绑（编辑机器人绑定）再删除');
    }
    await this.members.delete({ groupId: id });
    await this.repo.delete(id);
    await this.audit.log({
      tenantId: group.tenantId, question: `[群] 删除群（${group.name ?? group.chatId.slice(0, 10)}…）`,
      result: '成员级联删除 · 群记录移除',
    }).catch(() => undefined);
    return { ok: true };
  }
}
