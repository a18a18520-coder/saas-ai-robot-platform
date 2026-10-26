import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Tenant } from '../tenants/tenant.entity';

/** 平台审计 API（FR-021）——全租户操作/调用检索，对应 04 原型 platform-audit.html */
@Controller('api/v1/admin/audit')
export class PlatformAuditController {
  constructor(
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  /** 平台审计列表（租户/关键词/类型/时间筛选 + 分页，真实数据） */
  @Get()
  async list(
    @Query('tenantId') tenantId?: string,
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('hours') hours?: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    const where: Record<string, unknown> = {};
    if (tenantId) where.tenantId = tenantId;
    if (keyword) where.question = ILike(`%${keyword}%`);
    if (hours) where.createdAt = MoreThanOrEqual(new Date(Date.now() - Number(hours) * 3600 * 1000));
    // type 映射到 result（AuditLog 无独立 type 字段，诚实映射）：
    //   SECURITY → 权限拒绝 / QUOTA → 未命中转人工 / TENANT_CALL → 其余
    if (type === 'SECURITY') where.result = '权限拒绝';
    if (type === 'QUOTA') where.result = '未命中转人工';
    const [list, total] = await this.audits.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(size),
      take: Number(size),
    });
    // 租户名映射
    const tMap: Record<string, string> = {};
    for (const t of await this.tenants.find()) tMap[t.id] = t.name;
    return {
      list: list.map((a) => ({ ...a, tenantName: a.tenantId ? (tMap[a.tenantId] ?? a.tenantId.slice(0, 8)) : '—' })),
      total,
      page: Number(page),
      size: Number(size),
    };
  }

  /** 审计详情 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const item = await this.audits.findOne({ where: { id } });
    if (!item) return { code: 40401, message: '记录不存在', data: null };
    return { code: 0, message: 'success', data: item };
  }
}
