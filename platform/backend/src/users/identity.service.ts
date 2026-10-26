import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User, UserIdentity } from './user.entity';
import { GroupMember } from '../groups/group-member.entity';
import { AuditService } from '../audit/audit.service';
import { hashPhone, maskPhone } from './user.constants';

/**
 * Identity Resolver（FR-007 × BR-009）：
 * 手机号 = 系统唯一身份主键
 *  - 未提供手机号 → 复用/生成群临时身份（guest_渠道ID）
 *  - 提供手机号 → 主键查重 → 手机号一致的多用户自动合并
 *  - 命中企业人员库 → 升级员工身份（角色+部门）
 * 身份优先级: 人工设置 > 企业匹配 > 手机号认证 > 默认游客（BR-001）
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(GroupMember) private readonly groupMembers: Repository<GroupMember>,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** 解析身份：渠道用户 + 消息内容（可能含手机号）→ 平台用户 */
  async resolve(params: { tenantId: string; channel: string; channelUserId: string; content?: string; displayName?: string }): Promise<{
    user: User;
    identity: UserIdentity;
    source: 'phone_match' | 'employee_match' | 'guest';
    confidence: '高' | '低';
  }> {
    const displayName = params.displayName?.trim().slice(0, 100) || undefined;
    // 1) 现有渠道映射
    let identity = await this.identities.findOne({
      where: { tenantId: params.tenantId, channel: params.channel, channelUserId: params.channelUserId },
    });

    // 2) 对话中提取手机号（BR-001：手机号认证）
    const phone = this.extractPhone(params.content ?? '');
    if (phone) {
      const hash = hashPhone(phone);
      // 主键查重 → 多用户一致自动合并（mergeUsers 返回 keeper）
      const existing = await this.users.find({ where: { tenantId: params.tenantId, phoneHash: hash } });
      let owner: User | null = null;
      if (existing.length > 1) {
        owner = await this.mergeUsers(existing, phone);
        this.logger.log(`手机号 ${maskPhone(phone)} 合并 ${existing.length} 个用户 → keeper ${owner.id}`);
      } else if (existing.length === 1) {
        owner = existing[0];
        // 存量用户（迁移前创建，有 hash 无 masked）补写脱敏手机号
        if (owner.status === 'ACTIVE' && !owner.phoneMasked) {
          owner.phoneMasked = maskPhone(phone);
          await this.users.save(owner);
        }
      }
      if (!owner) {
        owner = await this.users.save(this.users.create({
          tenantId: params.tenantId,
          phoneHash: hash,
          phoneMasked: maskPhone(phone),
          name: displayName,
          identity: '用户',
        }));
      } else if (displayName && !owner.name) {
        owner.name = displayName;
        await this.users.save(owner);
      }
      identity = identity
        ? await this.identities.save(Object.assign(identity, { userId: owner.id, confidence: '高' as const }))
        : await this.identities.save(this.identities.create({
            tenantId: params.tenantId, userId: owner.id,
            channel: params.channel, channelUserId: params.channelUserId, confidence: '高',
          }));
      return { user: owner, identity, source: owner.identity === '员工' ? 'employee_match' : 'phone_match', confidence: '高' };
    }

    // 3) 无手机号 → 游客（复用/生成 guest 身份）
    if (!identity) {
      const guest = await this.users.save(this.users.create({ tenantId: params.tenantId, name: displayName, identity: '游客' }));
      identity = await this.identities.save(this.identities.create({
        tenantId: params.tenantId, userId: guest.id,
        channel: params.channel, channelUserId: params.channelUserId, confidence: '低',
      }));
      return { user: guest, identity, source: 'guest', confidence: '低' };
    }

    let user = await this.users.findOne({ where: { id: identity.userId, tenantId: params.tenantId } });
    if (!user) {
      user = await this.users.save(this.users.create({ tenantId: params.tenantId, name: displayName, identity: '游客' }));
      identity.userId = user.id;
      identity.confidence = '低';
      identity = await this.identities.save(identity);
    } else if (displayName && !user.name) {
      user.name = displayName;
      user = await this.users.save(user);
    }
    const employeeMatch = user?.identity === '员工' && identity.confidence === '高';
    return { user: user!, identity, source: employeeMatch ? 'employee_match' : 'guest', confidence: identity.confidence as '高' | '低' };
  }

  /**
   * 手机号合并（BR-009）：并入最早 ACTIVE 用户为 keeper（Round2 修复）
   *  - 事务化：渠道身份/群成员重指向 → 标记 MERGED → 审计，任一步失败整体回滚
   *  - 返回 keeper（resolve 直接使用，避免从合并前快照选错 owner）
   *  - 渠道身份重指向：keeper 上已有同渠道身份 → 删本行去重；否则 update 指向 keeper
   *    （修复旧逻辑 findOne 命中自身 → delete 自身 → update 空操作的自毁缺陷）
   */
  private async mergeUsers(users: User[], phone?: string): Promise<User> {
    return this.ds.transaction(async (manager) => {
      const usersRepo = manager.getRepository(User);
      const identsRepo = manager.getRepository(UserIdentity);
      const membersRepo = manager.getRepository(GroupMember);

      const sorted = [...users].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
      const keeper = sorted.find((u) => u.status === 'ACTIVE') ?? sorted[0];
      const merged = sorted.filter((u) => u.id !== keeper.id);

      for (const u of merged) {
        // ① 渠道身份：keeper 已有同渠道身份 → 本行冗余删除；否则重指向 keeper
        const idents = await identsRepo.find({ where: { userId: u.id } });
        for (const it of idents) {
          const onKeeper = await identsRepo.findOne({
            where: { tenantId: it.tenantId, channel: it.channel, channelUserId: it.channelUserId, userId: keeper.id },
          });
          if (onKeeper) await identsRepo.delete(it.id);
          else await identsRepo.update(it.id, { userId: keeper.id });
        }
        // ② 群成员重指向 keeper
        await membersRepo.update({ userId: u.id }, { userId: keeper.id });
        // ③ 标记合并 + 清空 phoneHash（同号唯一约束下防残留重复触发）
        await usersRepo.update(u.id, { status: 'MERGED', mergedIntoId: keeper.id, phoneHash: null });
      }
      if (merged.length) {
        await this.audit.log({
          tenantId: keeper.tenantId,
          userId: keeper.id,
          question: `[用户] 手机号自动合并（${phone ? maskPhone(phone) : '同号'} 命中 ${merged.length + 1} 个身份）`,
          result: `keeper: ${keeper.name ?? keeper.id.slice(0, 8)}；合并 ${merged.length} 个（渠道身份/群成员已归并）`,
          channelUserId: 'system',
        }).catch(() => undefined);
      }
      return keeper;
    });
  }

  /** 提取 11 位手机号（用户在对话中主动提供） */
  private extractPhone(text: string): string | null {
    const m = text.replace(/\s/g, '').match(/(?<!\d)1[3-9]\d{9}(?!\d)/);
    return m ? m[0] : null;
  }
}
