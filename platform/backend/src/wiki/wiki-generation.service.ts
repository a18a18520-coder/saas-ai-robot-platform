import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WikiImportService } from './wiki-import.service';
import { WikiService } from './wiki.service';

@Injectable()
export class WikiGenerationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(WikiGenerationService.name);
  constructor(private readonly db: DataSource, private readonly importer: WikiImportService, private readonly wiki: WikiService) {}
  onModuleInit() {
    if (process.env.WIKI_AUTO_GENERATION === 'false') return;
    this.timer = setInterval(() => { void this.tick().catch(e => this.logger.error(`Wiki 自动生成失败: ${e.message}`)); }, 10000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  list(tenant: string, dataset: string) {
    return this.db.query('SELECT id,name,status,page_id,error,updated_at FROM wiki_generation_jobs WHERE tenant_id=$1 AND dataset_id=$2 ORDER BY updated_at DESC LIMIT 100', [tenant, dataset]);
  }
  async retry(tenant: string, id: string) {
    const rows = await this.db.query("UPDATE wiki_generation_jobs SET status='queued',error='',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='failed' RETURNING id", [tenant, id]);
    if (!rows[0]?.length) throw new BadRequestException('任务不存在或不可重试');
    return { ok: true };
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    // A session lock prevents multiple backend processes from importing/publishing twice.
    const runner = this.db.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      locked = (await runner.query("SELECT pg_try_advisory_lock(hashtext('wiki-generation-worker')) AS locked"))[0].locked;
      if (!locked) return;
      await runner.query("UPDATE wiki_generation_jobs SET status='queued' WHERE status='running'");
      await runner.query(`INSERT INTO wiki_generation_jobs (tenant_id,dataset_id,document_id,name)
        SELECT f.tenant_id,f.dataset_id,f.dify_document_id,f.name FROM knowledge_files f
        JOIN knowledge_bases k ON k.tenant_id=f.tenant_id AND k.dataset_id=f.dataset_id
        WHERE f.is_active=true AND f.sync_status='completed' AND k.pipeline_config->>'autoWiki'='true'
        AND NOT EXISTS (SELECT 1 FROM wiki_pages p WHERE p.tenant_id=f.tenant_id AND p.id::text=f.source_id)
        ON CONFLICT (tenant_id,dataset_id,document_id) DO NOTHING`);
      const jobs = await runner.query(`SELECT j.* FROM wiki_generation_jobs j JOIN knowledge_bases k ON k.tenant_id=j.tenant_id AND k.dataset_id=j.dataset_id
        WHERE j.status='queued' AND k.pipeline_config->>'autoWiki'='true' ORDER BY j.updated_at LIMIT 3`);
      for (const job of jobs) {
        await runner.query("UPDATE wiki_generation_jobs SET status='running',updated_at=now() WHERE id=$1", [job.id]);
        try {
          const result = await this.importer.importDocument(job.tenant_id, job.dataset_id, job.document_id);
          const page = result.page;
          let status = 'review';
          if (page.status === 'archived') status = 'archived';
          else if (page.status === 'published') status = 'published';
          else if (page.revision === 1) {
            await this.wiki.publish(job.tenant_id, page.id, page.revision);
            status = 'published'; // Published means queued for indexing, not yet searchable.
          }
          await runner.query('UPDATE wiki_generation_jobs SET status=$2,page_id=$3,error=\'\',updated_at=now() WHERE id=$1', [job.id,status,page.id]);
        } catch (e) {
          await runner.query("UPDATE wiki_generation_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1", [job.id, (e as Error).message.slice(0,500)]);
        }
      }
    } finally {
      if (locked) await runner.query("SELECT pg_advisory_unlock(hashtext('wiki-generation-worker'))");
      await runner.release(); this.busy = false;
    }
  }
}
