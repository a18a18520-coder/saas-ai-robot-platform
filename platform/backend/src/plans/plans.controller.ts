import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PlansService } from './plans.service';
import { Plan } from './plan.entity';

/** 平台侧套餐管理 API（FR-020）——真实 CRUD + 30 天补价，对应 04 原型 plans.html */
@Controller('api/v1/admin/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** 套餐列表（平台侧展示） */
  @Get()
  list(): Promise<Array<Plan & { tenantCount: number }>> {
    return this.plans.list();
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<Plan> {
    return this.plans.findById(id);
  }

  /** 新增套餐档位 */
  @Post()
  create(@Body() body: Partial<Plan>): Promise<Plan> {
    return this.plans.create(body);
  }

  /** 修改套餐（即时生效 + 影响面提示） */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<Plan>): Promise<Plan> {
    return this.plans.update(id, body);
  }

  /** 停用/启用 */
  @Post(':id/active')
  setActive(@Param('id') id: string, @Body() body: { isActive: boolean }): Promise<Plan> {
    return this.plans.setActive(id, body.isActive);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.plans.remove(id);
  }

  /** 30 天补价计算（服务端权威） */
  @Post('calculate-diff')
  calculateDiff(@Body() body: { oldPlanId: string; newPlanId: string; usedDays: number; effectType: 'IMMEDIATE' | 'NEXT_CYCLE' }) {
    return this.plans.calculatePlanDiff(body);
  }
}
