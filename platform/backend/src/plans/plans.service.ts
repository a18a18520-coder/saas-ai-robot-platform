import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';
import { PlanPriceService } from './plan-price.service';
import { Tenant } from '../tenants/tenant.entity';
import { AuditService } from '../audit/audit.service';

/** 套餐管理（FR-020 平台侧）——真实 CRUD + 生命周期 + 补价计算 */
@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly price: PlanPriceService,
    private readonly audit: AuditService,
  ) {}

  /** 套餐列表（平台侧列表展示：含在用租户数，tenants.plan_id 分组计数） */
  async list(): Promise<Array<Plan & { tenantCount: number }>> {
    const plans = await this.repo.find({ order: { price: 'ASC' } });
    const counts = await this.tenants
      .createQueryBuilder('t')
      .select('t.plan_id', 'planId')
      .addSelect('COUNT(*)', 'cnt')
      .where('t.status != :deleted', { deleted: 'DELETED' })
      .groupBy('t.plan_id')
      .getRawMany<{ planId: string; cnt: string }>();
    const countMap = new Map(counts.map((c) => [c.planId, Number(c.cnt)]));
    return plans.map((p) => ({ ...p, tenantCount: countMap.get(p.id) ?? 0 }));
  }

  async findById(id: string): Promise<Plan> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('40401: 套餐不存在');
    return plan;
  }

  /** 新增套餐档位 */
  async create(data: Partial<Plan>): Promise<Plan> {
    this.validate(data);
    const plan = this.repo.create(data);
    return this.repo.save(plan);
  }

  /** 修改套餐（即时生效 + 写审计；在用租户提示影响面） */
  async update(id: string, data: Partial<Plan>): Promise<Plan> {
    this.validate(data);
    delete data.id;
    const plan = await this.findById(id);
    const changed = Object.keys(data).filter((k) => String((data as Record<string, unknown>)[k]) !== String((plan as unknown as Record<string, unknown>)[k]));
    Object.assign(plan, data);
    const saved = await this.repo.save(plan);
    if (changed.length > 0) {
      const inUse = await this.tenants.count({ where: { planId: id } });
      await this.audit.log({
        tenantId: 'platform',
        question: `[套餐] 修改套餐（${saved.name}）`,
        result: `变更字段: ${changed.join(', ')}；在用租户 ${inUse} 个（影响面需确认）`,
      }).catch(() => undefined);
    }
    return saved;
  }

  /** 停用/启用套餐 */
  private validate(data: Partial<Plan>) {
    for (const key of ['price', 'robotLimit', 'userLimit', 'kbLimit', 'aiQuota', 'storageLimitMb', 'channelLimit', 'adminWindowLimit', 'fileSizeLimitMb', 'validityDays'] as const) {
      if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key]! < (key === 'validityDays' ? 1 : 0) || data[key]! > 2147483647)) throw new HttpException('套餐价格、限额需为非负整数，有效天数至少为 1', 400);
    }
  }

  async setActive(id: string, isActive: boolean): Promise<Plan> {
    const plan = await this.findById(id);
    plan.isActive = isActive;
    const saved = await this.repo.save(plan);
    await this.audit.log({
      tenantId: 'platform',
      question: `[套餐] ${isActive ? '启用' : '停用'}套餐（${saved.name}）`,
      result: `is_active → ${isActive}`,
    }).catch(() => undefined);
    return saved;
  }

  /** 删除套餐（有租户在用需先迁移，防止删掉在用套餐） */
  async remove(id: string): Promise<void> {
    await this.findById(id);
    const inUse = await this.tenants.count({ where: { planId: id } });
    if (inUse > 0) {
      throw new HttpException(
        { code: 42201, message: `有 ${inUse} 个租户正在使用该套餐，请先为这些租户迁移套餐后再删除`, data: null },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.repo.delete(id);
  }

  /** 30 天补价计算（服务端权威，FR-001 公式） */
  async calculatePlanDiff(params: { oldPlanId: string; newPlanId: string; usedDays: number; effectType: 'IMMEDIATE' | 'NEXT_CYCLE' }) {
    const [oldPlan, newPlan] = await Promise.all([this.findById(params.oldPlanId), this.findById(params.newPlanId)]);
    return this.price.calculateDiff({
      oldPlanPrice: oldPlan.price,
      newPlanPrice: newPlan.price,
      usedDays: params.usedDays,
      effectType: params.effectType,
      oldValidityDays: oldPlan.validityDays, newValidityDays: newPlan.validityDays,
    });
  }
}
