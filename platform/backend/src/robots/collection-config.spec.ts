import { CollectionConfig, parseCollectionResult, validateCollectionConfig } from './collection-config';

export const config: CollectionConfig = {
  trigger: 'all', prompt: '收集设备故障', constraints: '不得推测', keywords: [],
  fields: [
    { key: 'device', label: '设备编号', type: 'string', required: true, description: '' },
    { key: 'count', label: '数量', type: 'number', required: false, description: '', rules: { sourceUnit: '台' } },
  ],
};
describe('collection configuration and grounding', () => {
  const output = (values: object, evidence: unknown) => JSON.stringify({ matched: true, reason: '设备故障', items: [{ values: { device: null, count: null, ...values }, evidence }] });
  it('accepts grounded, typed conversion', () => {
    expect(parseCollectionResult(output({ device: 'A-1', count: 2 }, { device: 'A-1', count: '2台' }), config, 'A-1 2台 故障')).toMatchObject({ status: 'collected', items: [{ values: { device: 'A-1', count: 2 } }] });
  });
  it('preserves missing required information as null for review', () => {
    expect(parseCollectionResult(output({ count: 2 }, { count: '2台' }), config, '2台 故障')).toMatchObject({ status: 'needs_review', items: [{ values: { device: null }, missingFields: ['device'] }] });
  });
  it('does not accept a value without a verbatim source quote', () => {
    expect(() => parseCollectionResult(output({ device: 'A-1' }, { device: 'A-1' }), config, '一台设备故障')).toThrow('原文依据');
  });
  it('does not silently coerce numbers from strings', () => {
    expect(() => parseCollectionResult(output({ count: '2' }, { count: '2' }), config, '2')).toThrow('类型');
  });
  it('rejects an all-null record even when every field is optional', () => {
    expect(() => parseCollectionResult(output({}, {}), { ...config, fields: config.fields.map(f => ({ ...f, required: false })) }, '你好')).toThrow('全部为空');
  });
  it('rejects undeclared fields and malformed results', () => {
    expect(() => parseCollectionResult(output({ external_action: 'send' }, {}), config, 'send')).toThrow('未配置');
    expect(() => parseCollectionResult('{"matched":"false","items":[],"reason":""}', config, 'x')).toThrow('格式');
    expect(() => parseCollectionResult('{"matched":true,"items":[],"reason":"x"}', config, 'x')).toThrow('1–20');
    expect(() => parseCollectionResult('{"matched":false,"items":[{}],"reason":"x"}', config, 'x')).toThrow('未命中');
  });
  it('rejects duplicate, reserved or unsupported field declarations', () => {
    expect(() => validateCollectionConfig({ ...config, fields: [config.fields[0], config.fields[0]] }, true)).toThrow('唯一');
    expect(() => validateCollectionConfig({ ...config, fields: [{ ...config.fields[0], key: 'constructor' }] })).toThrow('唯一');
    expect(() => validateCollectionConfig({ ...config, keywords: [''] })).toThrow('关键词');
  });
  it('allows incomplete drafts but requires task and fields before publication', () => {
    expect(() => validateCollectionConfig({ ...config, prompt: '', fields: [] })).not.toThrow();
    expect(() => validateCollectionConfig({ ...config, prompt: '', fields: [] }, true)).toThrow();
  });
});
