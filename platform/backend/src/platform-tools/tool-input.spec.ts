import { checkInput, quotedValues } from './tool-input';
describe('nested case input', () => {
  const schema = { type: 'object', properties: { defendants: { type: 'array', minItems: 1, items: { type: 'object', properties: { name: { type: 'string' }, idCard: { type: 'string' } }, required: ['name', 'idCard'] } } }, required: ['defendants'] };
  it('keeps collecting nested required fields', () => {
    expect(checkInput(schema, { defendants: [{ name: '测试被告' }] }, '参数', true)).toEqual(['参数.defendants[0].idCard']);
    expect(() => checkInput(schema, { defendants: [{ name: '测试被告' }] })).toThrow('必要参数');
  });
  it('accepts declared arrays and rejects extra nested fields', () => {
    expect(checkInput(schema, { defendants: [{ name: '测试被告', idCard: 'TEST' }] })).toEqual([]);
    expect(() => checkInput(schema, { defendants: [{ name: '测试被告', idCard: 'TEST', admin: true }] })).toThrow('未声明');
  });
  it('requires user evidence for every nested value', () => {
    expect(quotedValues([{ name: '测试被告', idCard: 'TEST' }], '测试被告')).toBe(false);
    expect(quotedValues([{ name: '测试被告', idCard: 'TEST' }], '测试被告 TEST')).toBe(true);
  });
});
