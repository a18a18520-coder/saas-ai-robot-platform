import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ContentFilterWord } from './content-filter-word.entity';
import { ContentFilterHit } from './content-filter-hit.entity';
import { AuditService } from '../audit/audit.service';

/** 内容黑白名单 API（FR-023）——对应 04 原型 content-filter.html */
@Controller('api/v1/admin/content-filter')
export class ContentFilterController {
  constructor(
    @InjectRepository(ContentFilterWord) private readonly repo: Repository<ContentFilterWord>,
    @InjectRepository(ContentFilterHit) private readonly hitsRepo: Repository<ContentFilterHit>,
    private readonly audit: AuditService,
  ) {}

  /** 词条列表（按类型/分类筛选） */
  @Get()
  list(@Query('listType') listType?: 'black' | 'white', @Query('category') category?: string): Promise<ContentFilterWord[]> {
    return this.repo.find({ where: { ...(listType ? { listType } : {}), ...(category ? { category } : {}) }, order: { hitCount: 'DESC' } });
  }

  /** 新增词条 */
  @Post()
  async create(@Body() body: Partial<ContentFilterWord>): Promise<ContentFilterWord> {
    const word = await this.repo.save(this.repo.create(body));
    await this.audit.log({
      tenantId: 'platform', question: `[黑白名单] ${word.listType === 'black' ? '加入黑名单' : '加入白名单'}（${word.word}）`,
      result: `分类: ${word.category ?? '通用'}${word.isActive === false ? '（停用）' : ''}`,
    }).catch(() => undefined);
    return word;
  }

  /** 停用/启用 */
  @Patch(':id/active')
  async setActive(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    const word = await this.repo.findOne({ where: { id } });
    if (!word) return { ok: false };
    await this.repo.update(id, { isActive: body.isActive });
    await this.audit.log({
      tenantId: 'platform', question: `[黑白名单] ${body.isActive ? '启用' : '停用'}词条（${word.word}）`,
      result: `is_active → ${body.isActive}`,
    }).catch(() => undefined);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const word = await this.repo.findOne({ where: { id } });
    if (!word) return { affected: 0 };
    const r = await this.repo.delete(id);
    await this.audit.log({
      tenantId: 'platform', question: `[黑白名单] 删除词条（${word.word}）`,
      result: `曾命中 ${word.hitCount} 次`,
    }).catch(() => undefined);
    return r;
  }

  /** 命中计数（过滤链路调用） */
  @Post(':id/hit')
  async hit(@Param('id') id: string) {
    await this.repo.increment({ id }, 'hitCount', 1);
    return { ok: true };
  }

  /** 命中记录（content-filter.html「命中记录」Tab：方向/租户筛选，默认最近 7 天） */
  @Get('hits')
  async hits(@Query('direction') direction?: 'input' | 'output', @Query('tenantId') tenantId?: string, @Query('hours') hours?: string) {
    const requestedHours = Number(hours);
    const lookbackHours = Number.isFinite(requestedHours) && requestedHours > 0 ? Math.min(requestedHours, 24 * 365) : 168;
    const where: Record<string, unknown> = { createdAt: MoreThanOrEqual(new Date(Date.now() - lookbackHours * 3600 * 1000)) };
    if (direction) where.direction = direction;
    if (tenantId) where.tenantId = tenantId;
    return this.hitsRepo.find({ where, order: { createdAt: 'DESC' }, take: 100 });
  }

  /** 今日命中统计（content-filter.html「今日命中」卡：输入/输出分向） */
  @Get('hits/today')
  async hitsToday() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const rows = await this.hitsRepo.find({ where: { createdAt: MoreThanOrEqual(todayStart) } });
    return {
      input: rows.filter((r) => r.direction === 'input' && r.listType === 'black').length,
      output: rows.filter((r) => r.direction === 'output' && r.listType === 'black').length,
      exempt: rows.filter((r) => r.action === 'EXEMPT').length,
      total: rows.length,
    };
  }
}
