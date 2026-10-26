import { IngestionService } from './ingestion.service';
import { IngestionJob } from './ingestion.entity';
import { KnowledgeFile } from './knowledge-file.entity';
export { KnowledgeFile } from './knowledge-file.entity';
import { BadRequestException, NotFoundException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { existsSync, mkdirSync, writeFileSync, createReadStream } from 'fs';
import { basename, join, resolve, relative, isAbsolute } from 'path';
import { Response } from 'express';
import { DifyClientService } from '../dify/dify-client.service';
import { AuditService } from '../audit/audit.service';
import { KnowledgeBase } from './knowledge-base.entity';

/** 租户侧知识库（FR-009）：列表/上传（密级）/同步状态 */
@Controller('api/v1/tenant/knowledge')
export class TenantKnowledgeController {
  constructor(
    private readonly dify: DifyClientService,
    private readonly audit: AuditService,
    private readonly ingestion: IngestionService,
    @InjectRepository(KnowledgeFile) private readonly files: Repository<KnowledgeFile>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(IngestionJob) private readonly jobs: Repository<IngestionJob>,
  ) {}

  /** 知识库列表（Dify Dataset + 平台文件记录） */
  @Get()
  async list(@Query('tenantId') tenantId: string) {
    const datasets = await this.kbs.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
    return datasets.map((d) => ({
      id: d.datasetId,
      name: d.name,
      visibility: d.visibility,
      files: [], // 文件详情由 /:datasetId/documents 提供
    }));
  }

  /** 文件列表 + 同步状态 + 大小 + 切片数（对齐原型 knowledge-detail.html） */
  @Get(':datasetId/documents')
  async documents(@Param('datasetId') datasetId: string, @Query('tenantId') tenantId: string) {
    await this.assertDatasetAccess(tenantId, datasetId);
    const statuses = await this.dify.getDocumentStatus('', datasetId);
    const files = await this.files.find({ where: { tenantId, datasetId } });
    const fileMap = new Map(files.map((f) => [f.difyDocumentId, f]));
    const rows = [];
    for (const s of statuses) {
      // Only active, tenant-managed documents participate in platform retrieval.
      // Superseded versions and Dify-only test documents are not current knowledge.
      const local = fileMap.get(s.id);
      if (!local || local.isActive === false) continue;
      if (s.indexing_status && local.syncStatus !== s.indexing_status) {
        await this.files.update({ id: local.id, tenantId, datasetId }, { syncStatus: s.indexing_status });
      }
      let segmentTotal: number | null = null;
      if (s.indexing_status === 'completed') {
        try {
          segmentTotal = (await this.dify.getDocumentSegments('', datasetId, s.id, 1)).total;
        } catch {
          segmentTotal = null; // Dify 未就绪时诚实为 null
        }
      }
      rows.push({
        ...s,
        secLevel: fileMap.get(s.id)?.secLevel ?? 1,
        size: fileMap.get(s.id)?.size ?? 0,
        segmentTotal,
      });
    }
    return rows;
  }

  /** 下载已上传知识文件 */
  @Get(':datasetId/documents/:documentId/download')
  async download(
    @Param('datasetId') datasetId: string,
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string,
    @Res() res: Response,
  ) {
    const file = await this.files.findOne({ where: { tenantId, datasetId, difyDocumentId: documentId } });
    if (!file) throw new NotFoundException('40401: 文件记录不存在');
    const dir = join(process.cwd(), 'uploads', tenantId);
    const job = await this.jobs.findOne({ where: { tenantId, datasetId, documentId }, order: { createdAt: 'DESC' } });
    const jobPath = job?.filePath ? resolve(job.filePath) : '';
    const within = jobPath ? relative(resolve(dir), jobPath) : '..';
    const candidates = [
      ...(jobPath && within && !within.startsWith('..') && !isAbsolute(within) ? [jobPath] : []),
      join(dir, `${documentId}_${this.safeFilename(file.name)}`),
    ];
    // 兼容不同文件名前缀
    const match = candidates.find((p) => existsSync(p)) ?? (() => {
      if (!existsSync(dir)) return '';
      const found = require('fs').readdirSync(dir).find((f) => f.startsWith(documentId));
      return found ? join(dir, found) : '';
    })();
    if (!match) throw new NotFoundException('40401: 本地副本不存在');
    res.download(match, this.safeFilename(file.name));
  }

  /** 更新知识文件（替换：删旧文档 → 传新文档，保留密级） */
  @Put(':datasetId/documents/:documentId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async update(
    @Param('datasetId') datasetId: string,
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    if (!file) throw new Error('40001: 缺少文件');
    const old = await this.files.findOne({ where: { tenantId, datasetId, difyDocumentId: documentId } });
    if (!old) throw new Error('40401: 文件记录不存在');
    const filename = this.safeFilename(file.originalname);

    return this.ingestion.enqueue(tenantId, datasetId, filename, file.buffer, old.secLevel, old.sourceId ?? old.difyDocumentId);
  }

  /** 预览文件切片（已上传知识内容） */
  @Get(':datasetId/documents/:documentId/segments')
  async preview(
    @Param('datasetId') datasetId: string,
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    await this.assertDatasetAccess(tenantId, datasetId);
    const p = Number(page), size = Number(limit);
    if (!Number.isInteger(p) || p < 1 || p > 100000 || !Number.isInteger(size) || size < 1 || size > 100) throw new BadRequestException('分页参数无效');
    return this.dify.getDocumentSegments('', datasetId, documentId, size, p);
  }

  /** 删除文件（级联清理 Dify） */
  @Delete(':datasetId/documents/:documentId')
  async remove(
    @Param('datasetId') datasetId: string,
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string,
  ) {
    const file = await this.files.findOne({ where: { tenantId, datasetId, difyDocumentId: documentId } });
    if (!file) throw new Error('40401: 文件记录不存在');
    await this.dify.deleteDocument('', datasetId, documentId);
    await this.files.delete(file.id);
    await this.audit.log({
      tenantId,
      question: `[知识库] 删除文档 ${documentId.slice(0, 8)}`,
      result: '知识删除',
    });
    return { ok: true };
  }

  /** 新建知识库（空状态 → 首文件上传创建 Dataset；含可见部门配置） */
  @Post()
  async create(@Body() body: { tenantId: string; name: string; visibility?: 'all' | 'restricted'; deptIds?: string[] }) {
    const datasetId = await this.dify.createDataset('', body.name);
    // 注册本地管控（含可见部门权限）
    await this.kbs.save(this.kbs.create({
      tenantId: body.tenantId,
      datasetId,
      name: body.name,
      visibility: body.visibility ?? 'all',
      deptIds: body.visibility === 'restricted' ? (body.deptIds ?? []) : [],
      createdBy: 'admin@demo.com',
    }));
    await this.audit.log({
      tenantId: body.tenantId,
      question: `[知识库] 新建 ${body.name}`,
      result: '知识库创建',
      answer: `可见性: ${body.visibility ?? 'all'}${(body.deptIds ?? []).length ? `（${body.deptIds.length} 部门）` : ''}`,
    });
    return { datasetId, status: 'empty', visibility: body.visibility ?? 'all', nextStep: 'upload-first-document' };
  }

  /** 上传文件（含密级）→ Dify 两步（uploadFile → createDocument） */
  @Post(':datasetId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async upload(
    @Param('datasetId') datasetId: string,
    @Query('tenantId') tenantId: string,
    @Query('secLevel') secLevel: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    if (!file) throw new Error('40001: 缺少文件');
    await this.assertDatasetAccess(tenantId, datasetId);
    const filename = this.safeFilename(file.originalname);
    const job = await this.ingestion.enqueue(tenantId, datasetId, filename, file.buffer, Number(secLevel) || 1);
    return { jobId: job.id, status: job.status };
  }

  private async assertDatasetAccess(tenantId: string, datasetId: string): Promise<void> {
    const kb = await this.kbs.findOne({ where: { tenantId, datasetId } });
    if (!kb) throw new Error('40401: 知识库不存在');
  }

  private safeFilename(value: string): string {
    const safe = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!safe || safe === '.' || safe === '..') throw new Error('40001: 文件名无效');
    return safe;
  }
}
