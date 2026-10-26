import { WikiGraphService } from './wiki-graph.service';
describe('graph authorization and provenance',()=>{
  const db={query:jest.fn()}; const service=new WikiGraphService(db as never,{} as never);
  const doc={datasetId:'ds',difyDocumentId:'doc',sourceId:'p',sourceVersion:'2'};
  const edge={subject:'甲',relation:'认识',object:'乙',quote:'甲认识乙'};
  beforeEach(()=>jest.clearAllMocks());
  it('does not read any graph with an empty authorization list',async()=>{
    expect(await service.retrieve('t','甲',[],1)).toEqual([]);expect(db.query).not.toHaveBeenCalled();
  });
  it('returns original quotes and never the inferred relationship as evidence',async()=>{
    db.query.mockResolvedValue([{page_id:'p',revision:2,dataset_id:'ds',title:'原文',content:'甲认识乙',edges:[edge],chunk_index:0}]);
    const results=await service.retrieve('t','甲',[doc],1);
    expect(results[0].content).toBe(edge.quote);
    expect(db.query.mock.calls[0][1]).toEqual(['t',['p'],1]);
    expect(db.query.mock.calls[0][0]).toContain("p.status='published'");
    expect(db.query.mock.calls[0][0]).toContain('p.sec_level <= $3');
  });
  it('excludes changed revisions and foreign datasets even if returned by the database',async()=>{
    db.query.mockResolvedValue([{page_id:'p',revision:1,dataset_id:'ds',content:'甲认识乙',edges:[edge]},{page_id:'p',revision:2,dataset_id:'other',content:'甲认识乙',edges:[edge]}]);
    expect(await service.retrieve('t','甲',[doc],1)).toEqual([]);
  });
});
