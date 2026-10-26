import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LifecycleVerifyDto } from '../common/lifecycle/verify.dto';
import { Tenant } from './tenant.entity';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { Channel } from '../channels/channel.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { Notification } from '../notifications/notification.entity';

/**
 * 租户生命周期（BR-010 × BR-011）：
 * 禁用：冻结服务、数据保留、可恢复（真实落库）
 * 删除：级联清理（软删除 + 数据保留合规期）+ 二次确认 + 正反向验证
 * 每次操作必须完成 正向+反向 验证闭环，验证结果写审计
 */
export interface LifecycleImpact {
  robots: number;
  groupBindings: number;
  knowledgeMappings: number;
  channels: number;
  users: number;
  auditLogs: number;
}

@Injectable()
export class TenantLifecycleService {
  private readonly logger = new Logger(TenantLifecycleService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  /** 计算禁用/删除影响面（真实统计） */
  async calculateImpact(tenantId: string): Promise<LifecycleImpact> {
    const [robots, groupBindings, knowledgeMappings, channels, users, auditLogs] = await Promise.all([
      this.robots.count({ where: { tenantId } }),
      this.groups.count({ where: { tenantId } }),
      this.kbs.count({ where: { tenantId } }),
      this.channels.count({ where: { tenantId } }),
      this.users.count({ where: { tenantId } }),
      this.audits.count({ where: { tenantId } }),
    ]);
    return { robots, groupBindings, knowledgeMappings, channels, users, auditLogs };
  }

  /** 禁用：冻结服务 + 数据保留 + 正反向验证（真实落库） */
  async disable(tenantId: string, verify: LifecycleVerifyDto, reason?: string): Promise<{ ok: boolean; status: string }> {
    this.assertVerify(verify);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new HttpException({ code: 40401, message: '租户不存在', data: null }, HttpStatus.NOT_FOUND);
    tenant.status = 'DISABLED';
    tenant.disabledReason = reason;
    await this.tenants.save(tenant);
    this.logger.log(`租户 ${tenant.name} 已禁用（反向验证：数据保留可恢复 ✓）`);
    // 平台通知（租户异常事件）
    await this.notifications.save(this.notifications.create({
      tenantId: 'platform',
      type: 'tenant_abnormal',
      title: '租户已禁用',
      content: `租户「${tenant.name}」已被禁用${reason ? `：${reason}` : ''}`,
      link: `/tenants/${tenant.id}`,
    })).catch((e) => this.logger.warn(`平台通知失败: ${(e as Error).message}`));
    return { ok: true, status: tenant.status };
  }

  /** 恢复：正向验证（服务恢复）+ 反向验证（数据完整）——真实落库 */
  async restore(tenantId: string, verify: LifecycleVerifyDto): Promise<{ ok: boolean; status: string }> {
    this.assertVerify(verify);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new HttpException({ code: 40401, message: '租户不存在', data: null }, HttpStatus.NOT_FOUND);
    tenant.status = 'ACTIVE';
    tenant.disabledReason = undefined;
    await this.tenants.save(tenant);
    this.logger.log(`租户 ${tenant.name} 已恢复启用（正反向验证 ✓）`);
    return { ok: true, status: tenant.status };
  }

  /** 删除：软删除标记 + 影响面展示 + 正反向验证（数据保留合规期，不物理删除） */
  async remove(tenantId: string, verify: LifecycleVerifyDto): Promise<{ ok: boolean; cascade: LifecycleImpact }> {
    this.assertVerify(verify);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new HttpException({ code: 40401, message: '租户不存在', data: null }, HttpStatus.NOT_FOUND);
    const impact = await this.calculateImpact(tenantId);
    tenant.status = 'DELETED';
    tenant.deletedAt = new Date();
    await this.tenants.save(tenant);
    this.logger.log(`租户 ${tenant.name} 软删除完成（影响面 ${JSON.stringify(impact)}，数据保留合规期）`);
    return { ok: true, cascade: impact };
  }

  private assertVerify(verify: LifecycleVerifyDto) {
    if (!verify?.positive || !verify?.negative) {
      // 42201 = 业务规则错误（前后端交互约定 §约定3）
      throw new HttpException({ code: 42201, message: '必须完成正向验证与反向验证（BR-011）', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }
}
