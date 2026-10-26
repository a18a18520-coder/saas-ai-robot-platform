import { renderOutput, renderOutputList, validateOutput, validateOutputSchema } from './tool-output';
const schema = { type: 'object', properties: { status: { type: 'string' }, count: { type: 'integer' } }, required: ['status', 'count'] };
it('renders each actual list record, empty results and null values', () => {
  expect(renderOutputList('案件{{item.id}}，客户{{item.name}}。', { data: { records: [{ id: 'A', name: '张三' }, { id: 'B', name: null }] } }, 'data.records')).toBe('案件A，客户张三。\n案件B，客户未提供。');
  expect(renderOutputList('{{item.id}}', { data: { records: [] } }, 'data.records')).toBe('未找到匹配记录。');
});
it('rejects missing and wrongly typed API fields', () => {
  expect(() => validateOutputSchema(schema)).not.toThrow();
  expect(() => validateOutput(schema, { status: '成功' })).toThrow('缺失');
  expect(() => validateOutput(schema, { status: '成功', count: '2' })).toThrow('类型');
  expect(() => validateOutput(schema, { status: '成功', count: 2 })).not.toThrow();
});
it('renders only actual output values and rejects unknown placeholders', () => {
  expect(renderOutput('状态：{{status}}；数量：{{count}}', { status: '已受理', count: 2 })).toBe('状态：已受理；数量：2');
  expect(() => renderOutput('{{secret}}', { status: '已受理' })).toThrow('缺少');
});
