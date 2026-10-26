import { fuseRecallLists, retrievalKeywords } from './retrieval-keywords';

describe('supplemental recall', () => {
  it('extracts Chinese terms and adds vocabulary without injecting answer entities', () => {
    expect(retrievalKeywords('主角是谁')).toEqual(['名字', 'ID', '姓名']);
    expect(retrievalKeywords('主角进入的游戏叫什么')).toEqual(['游戏', '网游']);
    expect(retrievalKeywords('退货窗口是多久')).toContain('退货');
  });
  it('balances semantic and literal candidates and deduplicates by dataset/document/segment', () => {
    const hit = (id: string, datasetId = 'ds'): any => ({ datasetId, documentId: 'doc', segmentId: id, content: id, score: 0.5 });
    const result = fuseRecallLists([[hit('a'), hit('b'), hit('a')], [hit('c'), hit('b'), hit('a', 'other')]], 5);
    expect(result.map(h => `${h.datasetId}/${h.segmentId}`)).toEqual(['ds/b', 'ds/a', 'ds/c', 'other/a']);
  });
});
