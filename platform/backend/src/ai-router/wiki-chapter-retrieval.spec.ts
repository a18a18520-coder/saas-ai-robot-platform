import { chapterText, requestedChapter, retrieveWikiChapter } from './wiki-chapter-retrieval';
import { WikiPage } from '../wiki/wiki.entity';

describe('Wiki chapter evidence', () => {
  it('normalizes Chinese chapter numbers and preserves the full chapter boundary', () => {
    expect(requestedChapter('第一章讲什么')).toBe(1);
    expect(requestedChapter('第二十一章')).toBe(21);
    expect(requestedChapter('第一章和第二章')).toBeUndefined();
    expect(chapterText('# 书名\n# 第1章 开始\n第一句。\n第二句。\n# 第2章 后续\n秘密', 1)).toBe('# 第1章 开始\n第一句。\n第二句。');
    expect(chapterText('正文中提到第1章，不是标题', 1)).toBeUndefined();
  });
  const file = { tenantId: 't', datasetId: 'kb', isActive: true, secLevel: 1, syncStatus: 'completed', difyDocumentId: 'doc', sourceId: 'wiki', sourceVersion: '1' };
  const page = { id: 'wiki', datasetId: 'kb', status: 'published', secLevel: 1, publishedRevision: 1, content: '未发布的修改' };
  function setup(overrides = {}) {
    const repo = { find: jest.fn().mockResolvedValue([{ ...file, ...overrides }]), manager: { find: jest.fn().mockResolvedValue([page]), findOne: jest.fn().mockResolvedValue({ title: '书名', content: '# 第1章 开始\n已发布的原文\n# 第2章 后续\n后续内容' }) } };
    return repo;
  }
  it('reads only the indexed published revision with tenant and dataset scope', async () => {
    const repo = setup();
    const hits = await retrieveWikiChapter(repo as never, 't', ['kb'], 1, ['wiki'], '第一章讲什么');
    expect(hits).toHaveLength(1);
    expect(hits!.map(hit => hit.content).join('\n')).toContain('已发布的原文');
    expect(hits!.map(hit => hit.content).join('\n')).not.toContain('后续内容');
    expect(repo.manager.find).toHaveBeenCalledWith(WikiPage, { where: { tenantId: 't' } });
    expect(repo.manager.findOne).toHaveBeenCalledWith(expect.anything(), { where: { tenantId: 't', pageId: 'wiki', revision: 1 } });
  });
  it.each([{ secLevel: 2 }, { syncStatus: 'revoked' }, { sourceVersion: '2' }])('denies inaccessible or stale evidence %j', async overrides => {
    expect(await retrieveWikiChapter(setup(overrides) as never, 't', ['kb'], 1, ['wiki'], '第一章')).toEqual([]);
  });
  it('denies out-of-root and archived Wiki pages', async () => {
    const repo = setup();
    expect(await retrieveWikiChapter(repo as never, 't', ['kb'], 1, ['other'], '第一章')).toEqual([]);
    repo.manager.find.mockResolvedValue([{ ...page, status: 'archived' }]);
    expect(await retrieveWikiChapter(repo as never, 't', ['kb'], 1, [], '第一章')).toEqual([]);
  });
  it('keeps general questions on the normal sentence retrieval path', async () => {
    const repo = setup();
    expect(await retrieveWikiChapter(repo as never, 't', ['kb'], 1, [], '游戏叫什么')).toBeNull();
    expect(repo.find).not.toHaveBeenCalled();
  });
});
