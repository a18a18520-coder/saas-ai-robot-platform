import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { DifyClientService } from '../dify/dify-client.service';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { KnowledgeFile } from '../knowledge/knowledge-file.entity';
import { WikiPage, WikiVersion } from './wiki.entity';

@Injectable()
export class WikiImportService {
  constructor(private readonly db: DataSource, private readonly dify: DifyClientService) {}

  async importDocument(tenantId: string, datasetId: string, documentId: string) {
    if (!datasetId || !documentId) throw new BadRequestException('请选择来源文件');
    const kb = await this.db.getRepository(KnowledgeBase).findOneBy({ tenantId, datasetId });
    if (!kb) throw new NotFoundException('知识库不存在');
    const file = await this.db.getRepository(KnowledgeFile).findOneBy({ tenantId, datasetId, difyDocumentId: documentId, isActive: true });
    if (!file) throw new BadRequestException('仅支持已登记且有效的上传文件');
    if (file.sourceId && await this.db.getRepository(WikiPage).findOneBy({ tenantId, id: file.sourceId })) throw new BadRequestException('来源已是 Wiki 页面，请直接编辑原页面');
    const decodedName = Buffer.from(file.name, 'latin1').toString('utf8');
    const name = /^[\u0000-\u00ff]+$/.test(file.name) && !decodedName.includes('\ufffd') ? decodedName : file.name;
    const hex = createHash('sha256').update(JSON.stringify([tenantId, datasetId, documentId])).digest('hex');
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const existing = await this.db.getRepository(WikiPage).findOneBy({ tenantId, id });
    if (existing) return { page: existing, reused: true };
    const document = (await this.dify.getDocumentStatus('', datasetId)).find(d => d.id === documentId);
    if (document?.indexing_status !== 'completed') throw new BadRequestException('请等待文件切片完成后再创建 Wiki');
    const chunks: Array<{ content: string; position?: number }> = [];
    let total = -1;
    for (let page = 1; ; page++) {
      const result = await this.dify.getDocumentSegments('', datasetId, documentId, 100, page);
      if (total !== -1 && total !== result.total) throw new BadRequestException('文件切片正在变化，请稍后重试');
      total = result.total;
      chunks.push(...result.list);
      if (chunks.length >= total) break;
      if (!result.list.length || page >= 10000) throw new BadRequestException('切片读取不完整，未创建 Wiki');
    }
    const content = chunks.sort((a,b) => (a.position ?? 0) - (b.position ?? 0)).map(c => c.content).join('\n\n');
    if (!content.trim() || chunks.length !== total) throw new BadRequestException('文件没有完整可导入的正文');
    const source = `> 来源文件：${name}\n> 知识库：${kb.name}\n> 文档编号：${documentId}\n\n`;
    if ((source + content).length > 500000) throw new BadRequestException('正文超过单篇 Wiki 的 50 万字符限制，请拆分文件后导入');
    return this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      const saved = await manager.findOneBy(WikiPage, { tenantId, id });
      if (saved) return { page: saved, reused: true };
      const page = await manager.save(WikiPage, manager.create(WikiPage, { id, tenantId, datasetId, title: name.replace(/\.[^.]+$/, '').slice(0,200), content: source + content, kind: 'page', status: 'draft', secLevel: file.secLevel, revision: 1 }));
      await manager.save(WikiVersion, manager.create(WikiVersion, { tenantId, pageId: id, revision: 1, title: page.title, content: page.content }));
      return { page, reused: false };
    });
  }
}
