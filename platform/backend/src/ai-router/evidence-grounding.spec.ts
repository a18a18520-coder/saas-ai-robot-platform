import { renderGroundedSummary, renderGroundedExtracts, INSUFFICIENT_EVIDENCE } from './evidence-grounding';
const evidence: any[] = [{ content: '商品未拆封且购买后七日内可退货。' }];
describe('strict evidence rendering', () => {
  it('renders exact source text without free model claims', () => {
    expect(renderGroundedExtracts(JSON.stringify({ sufficient: true, extracts: [{ source: 1, quote: evidence[0].content }], answer: '可无限期退货' }), evidence).text).toBe('原文依据：\n「商品未拆封且购买后七日内可退货。」[1]');
  });
  it('rejects a real citation paired with invented text', () => {
    expect(() => renderGroundedExtracts(JSON.stringify({ sufficient: true, extracts: [{ source: 1, quote: '三十日内可退货' }] }), evidence)).toThrow('不一致');
  });
  it('rejects a nonexistent source', () => {
    expect(() => renderGroundedExtracts(JSON.stringify({ sufficient: true, extracts: [{ source: 9, quote: evidence[0].content }] }), evidence)).toThrow();
  });
  it('returns a fixed abstention without fabricated citations', () => {
    expect(renderGroundedExtracts('{"sufficient":false}', evidence)).toEqual({ text: INSUFFICIENT_EVIDENCE, refs: [], extracts: [], grounded: false });
  });
});


describe('grounded summary structure', () => {
  it('keeps a direct answer and assigns citation numbers from verified source quotes', () => {
    const result = renderGroundedSummary(JSON.stringify({sufficient:true,points:[{text:'未拆封商品在购买后七日内可退货。',citations:[{source:1,quote:evidence[0].content}]}]}),evidence);
    expect(result.text).toBe('未拆封商品在购买后七日内可退货。[1]');
  });
  it('rejects paraphrases without supporting quotes', () => {
    expect(()=>renderGroundedSummary(JSON.stringify({sufficient:true,points:[{text:'三十天',citations:[]}]}),evidence)).toThrow();
    expect(()=>renderGroundedSummary(JSON.stringify({sufficient:true,points:[{text:'三十天',citations:[{source:1,quote:'三十天'}]}]}),evidence)).toThrow();
  });
});


it('corrects only an exact unique quote in the same authorized document', () => {
  const source = {datasetId:'ds',documentId:'doc',content:'甲是人物'} as any;
  const data = {sufficient:true,points:[{text:'乙是姓名',citations:[{source:1,quote:'乙是姓名'}]}]};
  expect(renderGroundedSummary(JSON.stringify(data),[source,{...source,content:'乙是姓名'}]).refs).toEqual([2]);
  expect(()=>renderGroundedSummary(JSON.stringify(data),[source,{...source,documentId:'other',content:'乙是姓名'}])).toThrow();
  expect(()=>renderGroundedSummary(JSON.stringify(data),[source,{...source,content:'乙是姓名'},{...source,content:'乙是姓名'}])).toThrow();
});


it('removes only quotation wrapper punctuation, never changes the quoted words', () => {
  const ev = [{datasetId:'ds',documentId:'doc',content:'他说：“七天内退货，商品须未拆封。”'}] as any;
  const payload = (quote: string) => JSON.stringify({sufficient:true,points:[{text:'须未拆封',citations:[{source:1,quote}]}]});
  expect(renderGroundedSummary(payload('“七天内退货，”'),ev).extracts[0].quote).toBe('七天内退货，');
  expect(()=>renderGroundedSummary(payload('“七天内不可退货。”'),ev)).toThrow();
});
