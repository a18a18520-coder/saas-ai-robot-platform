import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WikiPage, WikiVersion } from './wiki.entity';
import { KnowledgeFile } from '../knowledge/knowledge-file.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { IngestionService } from '../knowledge/ingestion.service';
@Injectable()
export class WikiService {
  constructor(@InjectRepository(WikiPage) private readonly pages: Repository<WikiPage>, @InjectRepository(WikiVersion) private readonly versions: Repository<WikiVersion>, private readonly db: DataSource, private readonly ingestion: IngestionService) {}
  list(tenantId: string) { return this.pages.find({ where: { tenantId }, order: { title: 'ASC' } }); }
  async page(tenantId: string, id: string) { const p = await this.pages.findOne({ where: { tenantId, id } }); if (!p) throw new NotFoundException('页面不存在'); return p; }
  async history(tenantId: string, id: string) { await this.page(tenantId, id); return this.versions.find({ where: { tenantId, pageId: id }, order: { revision: 'DESC' }, take: 100 }); }
  async save(tenantId: string, body: Partial<WikiPage>, id?: string) {
    return this.db.transaction(async manager => {
      const repo = manager.getRepository(WikiPage);
      const page = id ? await repo.findOne({ where: { tenantId, id }, lock: { mode: 'pessimistic_write' } }) : repo.create({ tenantId, title: '', content: '', kind: body.kind === 'folder' ? 'folder' : 'page', revision: 0, status: 'draft', secLevel: 1, datasetId: '' });
      if (!page) throw new NotFoundException('页面不存在');
      if (id && body.revision !== page.revision) throw new ConflictException('页面已被其他人修改，请重新加载后再保存');
      if (page.status === 'archived') throw new BadRequestException('归档页面不能修改');
      if (body.title !== undefined) page.title = body.title.trim();
      if (!page.title || page.title.length > 200) throw new BadRequestException('标题需为 1–200 字符');
      if (body.content !== undefined) page.content = body.content;
      if (typeof page.content !== 'string' || page.content.length > 500000) throw new BadRequestException('页面内容过长');
      if (body.secLevel !== undefined) {
        if (![1, 2, 3].includes(body.secLevel)) throw new BadRequestException('密级无效');
        page.secLevel = body.secLevel;
      }
      if (body.datasetId !== undefined) {
        if (body.datasetId && !await manager.findOne(KnowledgeBase, { where: { tenantId, datasetId: body.datasetId } })) throw new BadRequestException('知识库不属于当前租户');
        if (page.publishedRevision && page.datasetId !== body.datasetId) throw new BadRequestException('已发布页面不能更换知识库，请复制为新页面');
        page.datasetId = body.datasetId;
      }
      if (body.parentId !== undefined) {
        let parentId = body.parentId;
        const visited = new Set<string>(page.id ? [page.id] : []);
        while (parentId) {
          if (visited.has(parentId)) throw new BadRequestException('目录不能形成循环');
          visited.add(parentId);
          const parent = await repo.findOne({ where: { tenantId, id: parentId } });
          if (!parent || parent.kind !== 'folder' || parent.status === 'archived') throw new BadRequestException('目录不可用');
          parentId = parent.parentId ?? '';
        }
        page.parentId = body.parentId || null as any;
      }
      page.revision++; page.updatedAt = new Date();
      const saved = await repo.save(page);
      await manager.save(WikiVersion, manager.create(WikiVersion, { tenantId, pageId: saved.id, revision: saved.revision, title: saved.title, content: saved.content }));
      // Clearance changes apply to old searchable versions immediately as well.
      await manager.update(KnowledgeFile, { tenantId, sourceId: saved.id }, { secLevel: saved.secLevel as 1|2|3 });
      return saved;
    });
  }
  async restore(tenantId: string, id: string, version: number, expectedRevision: number) {
    const old = await this.versions.findOne({ where: { tenantId, pageId: id, revision: version } });
    if (!old) throw new NotFoundException('版本不存在');
    return this.save(tenantId, { title: old.title, content: old.content, revision: expectedRevision }, id);
  }
  async publish(tenantId: string, id: string, revision: number) {
    const page = await this.page(tenantId, id);
    if (page.revision !== revision) throw new ConflictException('请重新加载最新版本后发布');
    if (page.kind !== 'page' || page.status === 'archived' || !page.content.trim() || !page.datasetId) throw new BadRequestException('发布需要正文和目标知识库');
    const job = await this.ingestion.enqueue(tenantId, page.datasetId, `${page.title}.md`, Buffer.from(`# ${page.title}\n\n${page.content}`), page.secLevel, page.id, String(page.revision));
    const updated = await this.pages.update({ id, tenantId, revision, status: page.status }, { status: 'published', publishedRevision: revision, updatedAt: new Date() });
    if (!updated.affected) throw new ConflictException('页面已修改，请核对发布状态');
    return { page: await this.page(tenantId, id), jobId: job.id, status: job.status };
  }
  async archive(tenantId: string, id: string) {
    const page = await this.page(tenantId, id);
    if (page.kind === 'folder' && await this.pages.count({ where: { tenantId, parentId: id } })) throw new BadRequestException('请先移出子页面再归档目录');
    await this.db.transaction(async manager => {
      await manager.update(WikiPage, { tenantId, id }, { status: 'archived' });
      await manager.update(KnowledgeFile, { tenantId, sourceId: id }, { isActive: false, syncStatus: 'revoked' });
    });
    return { ok: true };
  }
}
