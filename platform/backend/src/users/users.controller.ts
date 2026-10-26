import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { User, UserIdentity } from './user.entity';
import { hashPhone, IDENTITIES, maskPhone } from './user.constants';
import { AuditService } from '../audit/audit.service';
import { LifecycleVerifyDto } from '../common/lifecycle/verify.dto';
import { DirectorySyncService } from './directory-sync.service';

const phoneRe = /^1[3-9]\d{9}$/;
/** 租户侧用户管理（对齐 users.html 原型）：列表/搜索/手动设置/软删/企业导入（错误行跳过） */
@Controller('api/v1/tenant/users')
export class UsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    private readonly audit: AuditService,
    private readonly directorySync: DirectorySyncService,
  ) {}

  /** 用户列表（?tenantId=&keyword=&status=），排除已合并（MERGED 永不出现在列表），附渠道聚合 + 脱敏手机号 + 可信度派生 */
  @Get()
  async list(
    @Query('tenantId') tenantId: string,
    @Query('keyword') keyword?: string,
    @Query('source') _source?: string,
    @Query('status') status?: 'ACTIVE' | 'DISABLED' | 'ALL',
  ) {
    if (!tenantId) return { code: 40001, message: '参数缺失: tenantId', data: null };
    const base: Record<string, unknown> = { tenantId };
    // 默认仅 ACTIVE；ALL 时仍排除 MERGED（合并用户永不在列表）
    if (status === 'DISABLED') base.status = 'DISABLED';
    else if (status === 'ALL') base.status = ILike('%'); // ACTIVE + DISABLED
    else base.status = 'ACTIVE';

    // 关键词：姓名 / 脱敏手机尾号 / 渠道来源 ID（user_identities.channel_user_id）
    let where: Record<string, unknown> | Array<Record<string, unknown>> = base;
    if (keyword) {
      const kw = keyword.trim();
      const branches: Array<Record<string, unknown>> = [
        { ...base, name: ILike(`%${kw}%`) },
        { ...base, phoneMasked: ILike(`%${kw}%`) },
      ];
      const viaIdentity = await this.identities.find({ where: { tenantId, channelUserId: ILike(`%${kw}%`) }, take: 100 });
      if (viaIdentity.length) branches.push({ ...base, id: In(viaIdentity.map((i) => i.userId)) });
      where = branches;
    }
    const users = await this.users.find({ where, order: { createdAt: 'DESC' }, take: 200 });
    const ids = users.map((u) => u.id);
    const idents = ids.length ? await this.identities.find({ where: { tenantId, userId: In(ids) } }) : [];
    return users.map((u) => {
      const mine = idents.filter((i) => i.userId === u.id);
      const channels = [...new Set(mine.map((i) => i.channel))];
      // 可信度派生（原型：高·企业匹配 / 高·手机号认证 / 低）：员工→企业匹配；有手机号→手机号认证；无→低
      const high = mine.some((i) => i.confidence === '高') || !!u.phoneHash;
      const sourceLabel = u.identity === '员工' ? '高·企业匹配' : high ? '高·手机号认证' : '低';
      return {
        id: u.id, tenantId: u.tenantId, name: u.name, identity: u.identity, role: u.role ?? null,
        department: u.department ?? null, status: u.status, createdAt: u.createdAt,
        phoneMasked: u.phoneMasked ?? null, // 列表不再返回 phoneHash 原文
        identityCount: mine.length, channels,
        confidence: high ? '高' : '低', confidenceSource: high ? (u.identity === '员工' ? '企业匹配' : '手机号认证') : null,
        sourceLabel,
      };
    });
  }

  /** 用户详情（含渠道身份映射） */
  @Get(':id')
  async detail(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const user = await this.users.findOne({ where: { id, tenantId } });
    if (!user) return { code: 40401, message: '用户不存在', data: null };
    const identities = await this.identities.find({ where: { tenantId, userId: id } });
    const { phoneHash: _ph, ...rest } = user;
    return { code: 0, message: 'success', data: { ...rest, phoneMasked: user.phoneMasked ?? null, identities } };
  }

  /** 手动设置（对齐原型手动设置 Modal）：身份/部门/关联手机号；身份白名单校验 + 写审计 */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Body() body: { knowledgeClearance?: number; identity?: string; department?: string; role?: string; phone?: string; status?: 'ACTIVE' | 'DISABLED' },
  ) {
    const user = await this.users.findOne({ where: { id, tenantId } });
    if (!user) throw new HttpException({ code: 40401, message: '用户不存在', data: null }, HttpStatus.NOT_FOUND);
    if (user.status === 'MERGED') {
      throw new HttpException({ code: 42201, message: '已合并用户不可直接编辑（以主身份为准）', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const changes: string[] = [];
    if (body.knowledgeClearance !== undefined) {
      if (![1, 2, 3].includes(body.knowledgeClearance)) throw new HttpException('知识密级需为 1、2 或 3', HttpStatus.BAD_REQUEST);
      user.knowledgeClearance = body.knowledgeClearance;
      changes.push(`知识密级→${body.knowledgeClearance}`);
    }
    if (body.identity !== undefined) {
      if (!IDENTITIES.includes(body.identity as never)) {
        throw new HttpException({ code: 40001, message: `身份不合法（可选: ${IDENTITIES.join('/')}）`, data: null }, HttpStatus.BAD_REQUEST);
      }
      if (user.identity !== body.identity) { user.identity = body.identity; changes.push(`身份→${body.identity}`); }
    }
    if (body.department !== undefined && user.department !== body.department) {
      user.department = body.department || undefined; changes.push(`部门→${body.department || '未分配'}`);
    }
    if (body.role !== undefined && user.role !== body.role) {
      user.role = body.role || undefined; changes.push(`角色→${body.role || '未指派'}`);
    }
    // 关联手机号（手动绑定 → 写 hash + 脱敏；若与既有用户同号则 409 提示走合并）
    if (body.phone) {
      if (!phoneRe.test(body.phone)) throw new HttpException({ code: 40001, message: '手机号格式不正确', data: null }, HttpStatus.BAD_REQUEST);
      const dup = await this.users.findOne({ where: { tenantId, phoneHash: hashPhone(body.phone) } });
      if (dup && dup.id !== id) {
        throw new HttpException({ code: 40901, message: '该手机号已绑定其他用户，命中自动合并（BR-009）', data: null }, HttpStatus.CONFLICT);
      }
      if (user.phoneHash !== hashPhone(body.phone)) {
        user.phoneHash = hashPhone(body.phone); user.phoneMasked = maskPhone(body.phone);
        changes.push(`绑定手机号 ${maskPhone(body.phone)}`);
      }
    }
    if (body.status && ['ACTIVE', 'DISABLED'].includes(body.status)) {
      user.status = body.status; changes.push(`状态→${body.status}`);
    }
    const saved = await this.users.save(user);
    if (changes.length) {
      await this.audit.log({
        tenantId, userId: id, question: `[用户] 手动设置（${saved.name ?? '未命名'}）`,
        result: changes.join('；'), channelUserId: 'admin',
      }).catch(() => undefined);
    }
    // 响应剥离 phoneHash（与 detail 一致，不泄露哈希原文）
    const { phoneHash: _ph, ...rest } = saved;
    return { code: 0, message: 'success', data: { ...rest, phoneMasked: saved.phoneMasked ?? null } };
  }

  /** 软删用户（原型删除操作；DISABLED + 运行时拦截，可恢复——不物理删除） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { verify?: LifecycleVerifyDto }) {
    if (!body?.verify?.positive || !body?.verify?.negative) {
      throw new HttpException({ code: 42201, message: '正反向验证必填（positive/negative）', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const user = await this.users.findOne({ where: { id, tenantId } });
    if (!user) throw new HttpException({ code: 40401, message: '用户不存在', data: null }, HttpStatus.NOT_FOUND);
    user.status = 'DISABLED';
    await this.users.save(user);
    await this.audit.log({
      tenantId, userId: id, question: `[用户] 删除（${user.name ?? '未命名'}）`,
      result: '软删=DISABLED，消息不再处理，可恢复', channelUserId: 'admin',
    }).catch(() => undefined);
    return { code: 0, message: `已删除「${user.name ?? '用户'}」（软删可恢复）`, data: { id, status: 'DISABLED' } };
  }

  /** 企业人员导入（对齐原型导入 Modal）：错误行跳过（非整批失败）+ 角色列 + 脱敏手机号 + ≤2000 行 */
  @Post('import-employees')
  async importEmployees(
    @Query('tenantId') tenantId: string,
    @Body() body: { employees: Array<{ name: string; phone: string; department?: string; role?: string }> },
  ) {
    if (!tenantId) return { code: 40001, message: '参数缺失: tenantId', data: null };
    const list = body?.employees ?? [];
    if (!list.length) return { code: 40001, message: '员工列表为空', data: null };
    if (list.length > 2000) return { code: 40001, message: '单次导入 ≤ 2000 行', data: null };

    let created = 0, updated = 0;
    const errors: Array<{ row: number; reason: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.name || !phoneRe.test(e.phone ?? '')) {
        errors.push({ row: i + 1, reason: !e.name ? '缺少姓名' : '手机号格式不正确' });
        continue; // 错误行跳过（PRD 验收：格式错误行跳过，不整批失败）
      }
      const hash = hashPhone(e.phone);
      const existing = await this.users.findOne({ where: { tenantId, phoneHash: hash } });
      if (existing) {
        if (existing.status === 'MERGED') { errors.push({ row: i + 1, reason: '该手机号归属已合并主身份' }); continue; }
        existing.name = e.name;
        if (e.department) existing.department = e.department;
        if (e.role) existing.role = e.role;
        if (existing.identity === '游客') existing.identity = '员工';
        await this.users.save(existing);
        updated++;
      } else {
        await this.users.save(this.users.create({
          tenantId, phoneHash: hash, phoneMasked: maskPhone(e.phone),
          name: e.name, department: e.department, role: e.role, identity: '员工',
        }));
        created++;
      }
    }
    // 导入操作写审计（原型导入 Modal 勾选项语义：导入写审计恒开启）
    await this.audit.log({
      tenantId, question: `[用户] 导入企业内部人员`, result: `新增 ${created} / 更新 ${updated} / 跳过 ${errors.length} 行`,
      channelUserId: 'admin',
    }).catch(() => undefined);
    return {
      code: 0,
      message: `已导入 ${created + updated} 人（新增 ${created} / 更新 ${updated}）${errors.length ? `，${errors.length} 行格式错误已跳过` : ''}`,
      data: { created, updated, errors },
    };
  }

  /** 从已连接企业渠道拉取通讯录，并建立高可信渠道身份映射。 */
  @Post('sync-directory')
  async syncDirectory(@Query('tenantId') tenantId: string, @Body() body: { channelId?: string }) {
    const data = await this.directorySync.sync(tenantId, body?.channelId);
    return { code: 0, message: `通讯录同步完成：新增 ${data.created} 人，更新 ${data.updated} 人`, data };
  }
}
