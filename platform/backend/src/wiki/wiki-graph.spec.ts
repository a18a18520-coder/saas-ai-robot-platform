import { graphChunks, parseGraph, walkGraph } from './wiki-graph';
describe('source-grounded graph',()=>{
  it('covers the entire uploaded content without dropping the tail',()=>{
    const source='甲'.repeat(17000)+'结束'; const chunks=graphChunks(source);
    expect(chunks.at(-1)).toContain('结束'); expect(chunks).toHaveLength(4);
  });
  it('rejects fabricated quotes and entities absent from the original quote',()=>{
    const edge={subject:'魏想',relation:'进入',object:'神陨',quote:'魏想进入神陨。'};
    expect(parseGraph(JSON.stringify({edges:[edge,{...edge,subject:'别人'},{...edge,quote:'伪造原文'}]}),'魏想进入神陨。')).toEqual([edge]);
  });
  it('walks no more than two hops and excludes disconnected entities',()=>{
    const edges=[['甲','乙'],['乙','丙'],['丙','丁'],['戊','己']].map(([subject,object])=>({subject,object,relation:'关联',quote:subject+object}));
    expect(walkGraph(edges,'甲的关系')).toEqual(edges.slice(0,2));
  });
});
