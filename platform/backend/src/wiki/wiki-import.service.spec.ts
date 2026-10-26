import { WikiImportService } from './wiki-import.service';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { KnowledgeFile } from '../knowledge/knowledge-file.entity';
import { WikiPage } from './wiki.entity';

describe('knowledge file to Wiki', () => {
  function setup() {
    const repositories = new Map<any, any>([
      [KnowledgeBase, { findOneBy: jest.fn().mockResolvedValue({ name: '知识库' }) }],
      [KnowledgeFile, { findOneBy: jest.fn().mockResolvedValue({ name: '章节.txt', secLevel: 3 }) }],
      [WikiPage, { findOneBy: jest.fn().mockResolvedValue(null) }],
    ]);
    const manager = { query: jest.fn(), findOneBy: jest.fn().mockResolvedValue(null), create: (_type: any, value: any) => value, save: jest.fn(async (_type, value) => value) };
    const db = { getRepository: (type: any) => repositories.get(type), transaction: jest.fn(fn => fn(manager)) };
    const dify = { getDocumentStatus: jest.fn().mockResolvedValue([{ id: 'document', indexing_status: 'completed' }]), getDocumentSegments: jest.fn().mockResolvedValueOnce({ list: [{ position: 1, content: '第一章' }], total: 2 }).mockResolvedValueOnce({ list: [{ position: 2, content: '结尾' }], total: 2 }) };
    return { service: new WikiImportService(db as any, dify as any), repositories, db, dify };
  }
  it('imports every page with source, inherited clearance and a draft version', async () => {
    const { service, dify } = setup();
    const { page } = await service.importDocument('tenant', 'dataset', 'document');
    expect(dify.getDocumentSegments).toHaveBeenLastCalledWith('', 'dataset', 'document', 100, 2);
    expect(page).toMatchObject({ secLevel: 3, status: 'draft', revision: 1 });
    expect(page.content).toContain('第一章\n\n结尾');
    expect(page.content).toContain('文档编号：document');
  });
  it('rejects a foreign dataset before contacting Dify', async () => {
    const { service, repositories, dify } = setup();
    repositories.get(KnowledgeBase).findOneBy.mockResolvedValue(null);
    await expect(service.importDocument('other', 'dataset', 'document')).rejects.toThrow('知识库不存在');
    expect(dify.getDocumentStatus).not.toHaveBeenCalled();
  });
  it('does not create a partial Wiki when pagination stops early', async () => {
    const { service, dify, db } = setup();
    dify.getDocumentSegments.mockReset().mockResolvedValue({ list: [], total: 2 });
    await expect(service.importDocument('tenant', 'dataset', 'document')).rejects.toThrow('不完整');
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('preserves an existing edited Wiki on repeated import', async () => {
    const { service, repositories, dify } = setup();
    repositories.get(WikiPage).findOneBy.mockResolvedValue({ content: '用户已修改', revision: 4 });
    expect(await service.importDocument('tenant', 'dataset', 'document')).toMatchObject({ reused: true, page: { revision: 4 } });
    expect(dify.getDocumentSegments).not.toHaveBeenCalled();
  });
});
