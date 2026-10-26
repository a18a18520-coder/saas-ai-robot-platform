import { CollectionConfig, CollectionField, CollectionFieldRules, CollectionValidationError, collectionOutputSchema, parseCollectionResult, validateCollectionConfig } from './collection-config';
import { parseCollectionJson, exactProduct } from './collection-json';

const field = (type: CollectionField['type'] = 'string', rules: CollectionFieldRules = {}): CollectionField => ({ key: 'value', label: '目标字段', type, required: true, description: '', rules });
const config = (f = field()): CollectionConfig => ({ trigger: 'all', prompt: '收集明确值', constraints: '不得猜测', keywords: [], fields: [f] });
const output = (value: unknown, quote?: unknown) => JSON.stringify({ matched: true, reason: '命中', items: [{ values: { value }, evidence: quote === undefined ? {} : { value: quote } }] });
const parse = (value: unknown, quote: string, source = quote, f = field()) => parseCollectionResult(output(value, quote), config(f), source);

describe('strict collection field contract', () => {
  it('rejects an invented value even with a real quote', () => {
    expect(() => parse('张三', '李四')).toThrow('不一致');
    expect(() => parse(999, '2', '2', field('number'))).toThrow('不一致');
  });
  it('does not silently summarize in strict mode', () => {
    expect(() => parse('设备坏了', '屏幕无法点亮')).toThrow('不一致');
    expect(parse('设备坏了', '屏幕无法点亮', '屏幕无法点亮', field('string', { mode: 'review' }))).toMatchObject({ status: 'needs_review', items: [{ reviewFields: ['value'] }] });
  });
  it('supports exact tagged text and rejects swapped fields', () => {
    const f = field('string', { sourceLabel: '负责人' });
    expect(parse('李四', '李四', '负责人：李四；报告人：张三', f).status).toBe('collected');
    expect(() => parse('张三', '张三', '负责人：李四；报告人：张三', f)).toThrow('标签');
    expect(() => parse('李四', '李四', '非负责人：李四', f)).toThrow('标签');
    expect(parse('张三', '张三', '负责[人]：张三', field('string', { sourceLabel: '负责[人]' })).status).toBe('collected');
  });
  it.each(['负责人：张三丰', '负责人：张三-备用', '负责人：张三_A'])('rejects truncated tagged text in %s', source => {
    expect(() => parse('张三', '张三', source, field('string', { sourceLabel: '负责人' }))).toThrow('完整');
  });
  it('does not borrow a valid ending from a different quote occurrence', () => {
    expect(() => parse('张三', '张三', '负责人：张三丰；报告人：张三', field('string', { sourceLabel: '负责人' }))).toThrow('完整');
  });
  it('retains complete tagged text and intentionally summarized review values', () => {
    expect(parse('张三丰', '张三丰', '负责人：张三丰；报告人：李四', field('string', { sourceLabel: '负责人' })).status).toBe('collected');
    expect(parse('张三', '张三丰', '负责人：张三丰', field('string', { sourceLabel: '负责人', mode: 'review' })).status).toBe('needs_review');
  });
  it.each(['2026年10月23日晚上', '2026年10月23日至25日', '2026年10月23日-25日'])('rejects a partial date from %s', source => {
    expect(() => parse('2026-10-23', '2026年10月23日', source, field('string', { format: 'date' }))).toThrow('独立取值');
  });
  it('prevents quotes with outer whitespace from bypassing token boundaries', () => {
    expect(() => parse(true, ' 是 ', '不是 是 的', field('boolean'))).toThrow('依据');
    expect(() => parse('张三', ' 张三 ', '负责人： 张三 丰', field('string', { sourceLabel: '负责人' }))).toThrow('完整');
  });
  it('validates number conversions without binary multiplication drift', () => {
    expect(parse(12000, '1.2万元', '预算：1.2万元', field('number', { sourceLabel: '预算', sourceUnit: '万元', multiplier: 10000 })).status).toBe('collected');
    expect(exactProduct('0.29', 100)).toBe(29);
    expect(parse(1200, '1,200台', '1,200台', field('number', { sourceUnit: '台' })).status).toBe('collected');
  });
  it.each(['约2台', '2-3台', '两台', '2台/天', '1,20台'])('rejects ambiguous or unsupported numeric quote %s', quote => {
    expect(() => parse(2, quote, quote, field('number', { sourceUnit: '台' }))).toThrow();
  });
  it.each(['不是', '是否', '可能是', '是不对的'])('does not cut affirmative words from %s', source => {
    expect(() => parse(true, '是', source, field('boolean'))).toThrow('独立取值');
  });
  it('requires the same quote occurrence to satisfy both label and boundary', () => {
    expect(() => parse(true, '是', '已付款：是假的；其他：是', field('boolean', { sourceLabel: '已付款' }))).toThrow('独立取值');
  });
  it('bounds label matching without mistaking a truncated prefix for a label boundary', () => {
    const f = field('string', { sourceLabel: '负责人' });
    const spaces = ' '.repeat(32);
    expect(parse('张三', '张三', `负责人${spaces}：${spaces}张三`, f).status).toBe('collected');
    expect(() => parse('张三', '张三', `非负责人${spaces}：${spaces}张三`, f)).toThrow('标签');
    expect(() => parse('张三', '张三', `负责人：${' '.repeat(1000)}张三`, f)).toThrow('标签');
  });
  it.each(['12台', '-2台', '约2台', '2台以上'])('rejects an isolated number fragment within %s', source => {
    expect(() => parse(2, '2台', source, field('number', { sourceUnit: '台' }))).toThrow('独立取值');
  });
  it('preserves zero and false and supports explicit boolean mappings', () => {
    expect(parse(0, '0', '0', field('number')).items[0].values.value).toBe(0);
    expect(parse(false, '未支付', '未支付', field('boolean', { trueValues: ['已支付'], falseValues: ['未支付'] })).items[0].values.value).toBe(false);
    expect(() => parse(true, '未支付', '未支付', field('boolean', { trueValues: ['已支付'], falseValues: ['未支付'] }))).toThrow('布尔值');
  });
  it('enforces numeric bounds and integers without rounding', () => {
    expect(() => parse(1.5, '1.5', '1.5', field('number', { integer: true }))).toThrow('整数');
    expect(() => parse(-1, '-1', '-1', field('number', { minimum: 0 }))).toThrow('范围');
    expect(() => parse(11, '11', '11', field('number', { maximum: 10 }))).toThrow('范围');
    expect(() => parse(0.12345678901234568, '0.1234567890123456789', '0.1234567890123456789', field('number'))).toThrow('精度');
  });
  it('enforces enum, length and valid absolute dates', () => {
    expect(() => parse('通过', '通过', '未通过', field('string', { enumValues: ['通过'] }))).toThrow('独立取值');
    expect(() => parse('未知', '未知', '未知', field('string', { enumValues: ['通过'] }))).toThrow('枚举');
    expect(() => parse('ABCD', 'ABCD', 'ABCD', field('string', { maxLength: 3 }))).toThrow('长度');
    expect(() => parse('A', 'A', 'A', field('string', { minLength: 2 }))).toThrow('长度');
    expect(parse('2028-02-29', '2028年2月29日', '2028年2月29日', field('string', { format: 'date' })).status).toBe('collected');
    expect(() => parse('2026-02-29', '2026年2月29日', '2026年2月29日', field('string', { format: 'date' }))).toThrow('有效');
    expect(() => parse('2026-10-23', '明天', '明天', field('string', { format: 'date' }))).toThrow('不一致');
  });
  it('rejects extra keys at every structural level and omitted fields', () => {
    const raw = JSON.parse(output('A', 'A'));
    expect(() => parseCollectionResult(JSON.stringify({ ...raw, approved: true }), config(), 'A')).toThrow('格式');
    expect(() => parseCollectionResult(JSON.stringify({ ...raw, items: [{ ...raw.items[0], actions: [] }] }), config(), 'A')).toThrow('额外');
    expect(() => parseCollectionResult(JSON.stringify({ ...raw, items: [{ values: {}, evidence: {} }] }), config(), 'A')).toThrow('显式');
    expect(() => parseCollectionResult(output(null, 'A'), config(), 'A')).toThrow('空值');
    expect(() => parseCollectionResult(JSON.stringify({ ...raw, items: [raw.items[0], raw.items[0]] }), config(), 'A')).toThrow('重复');
  });
  it('exposes safe field diagnostics with a zero-based item index', () => {
    try { parse('wrong', 'actual'); throw new Error('should reject'); }
    catch (error) { expect(error).toBeInstanceOf(CollectionValidationError); expect((error as CollectionValidationError).issue).toMatchObject({ code: 'FIELD_RULE', field: 'value', itemIndex: 0 }); expect((error as Error).message).not.toContain('wrong'); }
  });
  it('emits a closed schema requiring all field keys but allowing null values', () => {
    const schema = collectionOutputSchema(config());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.items.items.properties.values).toMatchObject({ required: ['value'], additionalProperties: false, properties: { value: { type: ['string', 'null'] } } });
  });
});

describe('strict configuration validation', () => {
  it.each([
    field('string', { maximum: 2 }), field('number', { maxLength: 5 }), field('boolean', { format: 'text' }),
    field('string', { minLength: 10, maxLength: 2 }), field('string', { enumValues: ['A', 'A'] }),
    field('string', { enumValues: ['abc'], maxLength: 2 }), field('string', { format: 'date', enumValues: ['明天'] }),
    field('number', { minimum: 2, maximum: 1 }), field('number', { multiplier: 0 }), field('number', { multiplier: NaN }),
    field('boolean', { trueValues: ['否'] }), field('boolean', { trueValues: [] }), field('boolean', { trueValues: [' 是'] }),
    field('number', { mode: 'review', multiplier: 2 }), field('string', { sourceLabel: ' ' }), field('string', { pattern: '.*' } as any),
  ])('rejects impossible, unsupported or misleading rules: %j', f => {
    expect(() => validateCollectionConfig(config(f), true)).toThrow();
  });
});

describe('strict model JSON parser', () => {
  it('accepts JSON escapes and a single fenced JSON result', () => {
    expect(parseCollectionJson('```json\n{"a":"\\\"\\n", "b":[true,false,null,1e2]}\n```')).toEqual({ a: '"\n', b: [true, false, null, 100] });
  });
  it.each(['{"x":1,"x":2}', '{"value":1,"\\u0076alue":2}', '{"a":{"x":1,"x":2}}', '{"x":9007199254740993}', '{"x":0.1234567890123456789}', '{"x":1e400}', '{} trailing', '[1,]'])('rejects ambiguous JSON %s', raw => {
    expect(() => parseCollectionJson(raw)).toThrow();
  });
  it('rejects overly deep or large responses', () => {
    expect(() => parseCollectionJson('['.repeat(14) + '0' + ']'.repeat(14))).toThrow('嵌套');
    expect(() => parseCollectionJson(' '.repeat(200001))).toThrow('过长');
  });
});
