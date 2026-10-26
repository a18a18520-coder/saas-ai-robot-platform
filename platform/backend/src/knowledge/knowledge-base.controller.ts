import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';
import { KnowledgeFile } from './tenant-knowledge.controller';
import { Dept } from '../roles/role.entity';
import { AuditService } from '../audit/audit.service';

/** 知识库可见性管控（部门查看范围）：所有部门 or 指定部门 */
@Controller('api/v1/tenant/knowledge-base')
export class KnowledgeBaseController {
  constructor(
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(Dept) private readonly depts: Repository<Dept>,
    @InjectRepository(KnowledgeFile) private readonly files: Repository<KnowledgeFile>,
    private readonly audit: AuditService,
  ) {}

  /** 知识库列表（含可见性/添加时间/添加人 + 文件数/同步状态，knowledge.html 列数据源） */
  @Get()
  async list(@Query('tenantId') tenantId: string): Promise<Array<KnowledgeBase & { deptNames?: string[]; fileCount?: number; syncStatus?: string; updatedAt?: Date }>> {
    const kbs = await this.kbs.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
    const depts = await this.depts.find({ where: { tenantId } });
    const allFiles = await this.files.find({ where: { tenantId } });
    return kbs.map((kb) => {
      const kbFiles = allFiles.filter((f) => f.datasetId === kb.datasetId && f.isActive !== false);
      // 同步状态（本地 knowledge_files.sync_status）：有文件且全部 completed→已同步；存在未完成→同步中；空库→空
      const syncStatus = kbFiles.length === 0 ? '空'
        : kbFiles.some(f => ['error', 'failed'].includes(f.syncStatus)) ? '同步失败'
        : kbFiles.every(f => f.syncStatus === 'completed') ? '已同步'
        : kbFiles.some(f => ['indexing', 'parsing', 'splitting', 'running'].includes(f.syncStatus)) ? '同步中' : '待同步';
      return {
        ...kb,
        deptNames: kb.deptIds.map((id) => depts.find((d) => d.id === id)?.name ?? id),
        fileCount: kbFiles.length,
        syncStatus,
        updatedAt: kbFiles.length ? kbFiles.map((f) => f.createdAt).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] : kb.createdAt,
      };
    });
  }

  /** 注册知识库（列表同步时自动/手动） */
  @Post()
  register(@Body() body: { tenantId: string; datasetId: string; name: string; createdBy?: string }): Promise<KnowledgeBase> {
    return this.kbs.save(this.kbs.create(body));
  }

  /** 设置可见性：all 所有部门 / restricted 指定部门 */
  @Put(':id/visibility')
  async setVisibility(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { visibility: 'all' | 'restricted'; deptIds?: string[] }) {
    const kb = await this.kbs.findOne({ where: { id, tenantId } });
    if (!kb) throw new Error('40401: 知识库不存在');
    kb.visibility = body.visibility;
    kb.deptIds = body.visibility === 'restricted' ? (body.deptIds ?? []) : [];
    return this.kbs.save(kb);
  }

  /** 删除知识库（本地记录；Dify Dataset 保留可重绑，knowledge.html 行内「删除」） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<{ ok: boolean }> {
    const kb = await this.kbs.findOne({ where: { id, tenantId } });
    if (!kb) throw new Error('40401: 知识库不存在');
    const files = await this.files.find({ where: { tenantId: kb.tenantId, datasetId: kb.datasetId } });
    if (files.length > 0) {
      throw new Error(`42201: 知识库内还有 ${files.length} 个文件，请先在详情页清空文件再删除`);
    }
    await this.kbs.delete(id);
    await this.audit.log({
      tenantId: kb.tenantId, question: `[知识库] 删除知识库（${kb.name}）`,
      result: '空库删除 · Dify Dataset 保留（可重新注册绑定）',
    }).catch(() => undefined);
    return { ok: true };
  }
}
