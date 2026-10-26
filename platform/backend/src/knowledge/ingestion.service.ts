import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { DifyClientService } from '../dify/dify-client.service';
import { KnowledgeBase } from './knowledge-base.entity';
import { KnowledgeFile } from './knowledge-file.entity';
import { WikiPage } from '../wiki/wiki.entity';
import { IngestionJob } from './ingestion.entity';
@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(IngestionService.name);
  constructor(@InjectRepository(IngestionJob) private readonly jobs: Repository<IngestionJob>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeFile) private readonly files: Repository<KnowledgeFile>,
    private readonly dify: DifyClientService, private readonly db: DataSource) {}
  onModuleInit() { this.timer = setInterval(() => { void this.tick().catch(() => this.logger.warn('入库任务检查失败')); }, 5000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async enqueue(tenantId: string, datasetId: string, name: string, content: Buffer, secLevel = 1, sourceId: string = randomUUID(), sourceVersion?: string, transaction?: EntityManager) {
    const kb = await this.kbs.findOne({ where: { tenantId, datasetId } });
    if (!kb?.pipelineConfig?.startNodeId) throw new BadRequestException('请先在知识库配置已发布的 Dify 流水线');
    if (![1, 2, 3].includes(secLevel)) throw new BadRequestException('文件密级无效');
    if (content.length > 15 * 1024 * 1024) throw new BadRequestException('单文件不能超过 15 MB，请拆分后上传');
    const version = sourceVersion ?? createHash('sha256').update(content).digest('hex');
    const jobs = transaction ? transaction.getRepository(IngestionJob) : this.jobs;
    const existing = await jobs.findOne({ where: { tenantId, datasetId, sourceId, sourceVersion: version } });
    if (existing) return existing;
    const dir = join(process.cwd(), 'uploads', tenantId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `source_${randomUUID()}_${basename(name)}`);
    await writeFile(filePath, content);
    try {
      return await jobs.save(jobs.create({ tenantId, datasetId, sourceId, sourceVersion: version, name: basename(name), filePath, size: content.length, secLevel, pipelineConfig: kb.pipelineConfig, status: 'queued', error: '' }));
    } catch (error) { await unlink(filePath).catch(() => undefined); throw error; }
  }
  list(tenantId: string, datasetId: string) { return this.jobs.find({ where: { tenantId, datasetId }, order: { createdAt: 'DESC' }, take: 100 }).then(rows => rows.map(({ filePath, ...row }) => row)); }
  async retry(tenantId: string, id: string) {
    const job = await this.jobs.findOne({ where: { tenantId, id } });
    if (!job || !['failed', 'uncertain'].includes(job.status)) throw new BadRequestException('任务不可重试');
    // Uncertain submission may have succeeded upstream. Never blindly create a duplicate.
    if (job.status === 'uncertain') throw new BadRequestException('提交结果不确定，请先在 Dify 核对文档，避免重复入库');
    job.status = job.documentId ? 'indexing' : 'queued'; job.error = ''; job.updatedAt = new Date();
    return this.jobs.save(job);
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const jobs = await this.jobs.find({ where: [{ status: 'queued' }, { status: 'indexing' }, { status: 'running' }], order: { createdAt: 'ASC' }, take: 10 });
      for (const job of jobs) {
        if (job.status === 'running') {
          if (Date.now() - job.updatedAt.getTime() > 180000) await this.jobs.update({ id: job.id, status: 'running' }, { status: 'uncertain', error: '任务中断，提交结果需要在 Dify 核对' });
          continue;
        }
        if (job.status === 'queued') {
          const claimed = await this.jobs.update({ id: job.id, status: 'queued' }, { status: 'running', updatedAt: new Date() });
          if (!claimed.affected) continue;
          try {
            const content = await readFile(job.filePath);
            const result = await this.dify.runFilePipeline(job.datasetId, job.pipelineConfig, content, job.name);
            await this.files.save(this.files.create({ tenantId: job.tenantId, datasetId: job.datasetId, difyDocumentId: result.documentId, name: job.name, secLevel: job.secLevel as 1|2|3, sourceId: job.sourceId, sourceVersion: job.sourceVersion, isActive: false, size: content.length, syncStatus: 'indexing' }));
            await this.jobs.update(job.id, { documentId: result.documentId, status: 'indexing', updatedAt: new Date() });
          } catch (e) {
            await this.jobs.update(job.id, { status: 'uncertain', error: (e as Error).message.slice(0, 300), updatedAt: new Date() });
          }
          continue;
        }
        try {
          const status = (await this.dify.getDocumentStatus('', job.datasetId)).find(d => d.id === job.documentId);
          if (status?.indexing_status === 'completed') {
            const preview = await this.dify.getDocumentSegments('', job.datasetId, job.documentId!, 1);
            if (!preview.total) throw new Error('索引完成但无可用切片');
            await this.db.transaction(async manager => {
              await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ingest:${job.tenantId}:${job.sourceId}`]);
              const wiki = await manager.findOne(WikiPage, { where: { tenantId: job.tenantId, id: job.sourceId } });
              const newer = await manager.findOne(IngestionJob, { where: { tenantId: job.tenantId, sourceId: job.sourceId, status: 'completed', createdAt: MoreThan(job.createdAt) } });
              if (wiki?.status === 'archived' || newer) {
                await manager.update(IngestionJob, job.id, { status: 'superseded', error: '来源已归档或存在较新版本' });
                return;
              }
              await manager.update(KnowledgeFile, { tenantId: job.tenantId, datasetId: job.datasetId, sourceId: job.sourceId }, { isActive: false });
              await manager.update(KnowledgeFile, { tenantId: job.tenantId, difyDocumentId: job.documentId }, { isActive: true, syncStatus: 'completed' });
              await manager.update(IngestionJob, { id: job.id, status: 'indexing' }, { status: 'completed', error: '', updatedAt: new Date() });
            });
          } else if (status && ['error', 'failed', 'paused'].includes(status.indexing_status)) {
            await this.jobs.update(job.id, { status: 'failed', error: `Dify 索引状态：${status.indexing_status}`, updatedAt: new Date() });
          }
        } catch (e) { await this.jobs.update(job.id, { error: (e as Error).message.slice(0, 300) }); }
      }
    } finally { this.busy = false; }
  }
}
