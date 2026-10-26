import { ContentFilterService } from './content-filter.service';

const black = { id: 'b1', word: '促销', listType: 'black', action: 'REJECT', isActive: true };
const white = { id: 'w1', word: '促销活动说明', listType: 'white', action: 'ALERT', isActive: true };

describe('ContentFilterService', () => {
  const words = { find: jest.fn(), increment: jest.fn() };
  const hits = { create: jest.fn((value) => value), save: jest.fn() };
  const service = new ContentFilterService(words as any, hits as any);

  beforeEach(() => jest.clearAllMocks());

  it('例外短语未出现在本次文本时，不应豁免黑名单词', async () => {
    words.find.mockResolvedValue([black, white]);
    const result = await service.filter('请提供促销方案', { direction: 'input' });
    expect(result).toEqual({ text: '', action: 'REJECTED', words: ['促销'] });
    expect(hits.create).toHaveBeenCalledWith(expect.objectContaining({ listType: 'black', action: 'REJECT' }));
  });

  it('本次文本包含完整例外短语时，才记录豁免并放行', async () => {
    words.find.mockResolvedValue([black, white]);
    const result = await service.filter('查看促销活动说明', { direction: 'input' });
    expect(result).toEqual({ text: '查看促销活动说明', action: 'PASS', words: [] });
    expect(hits.create).toHaveBeenCalledWith(expect.objectContaining({ listType: 'white', action: 'EXEMPT' }));
  });

  it('不对其他租户应用指定作用域的词条', async () => {
    words.find.mockResolvedValue([{ ...black, scope: '指定:tenant-a' }]);
    const result = await service.filter('促销方案', { tenantId: 'tenant-b', direction: 'input' });
    expect(result).toEqual({ text: '促销方案', action: 'PASS', words: [] });
    expect(hits.save).not.toHaveBeenCalled();
  });
});
