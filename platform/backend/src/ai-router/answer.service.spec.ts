import { AnswerService } from './answer.service';

describe('answer context and evidence controls', () => {
  const model = { contextWindow: 10000, maxOutputTokens: 1000 };
  const robot: any = { id: 'r', tenantId: 't', ragConfig: { primaryModelId: 'p', historyTurns: 1, compressionThreshold: 0.1 } };
  const evidence: any[] = ['a', 'b'].map(id => ({ datasetId: 'ds', documentId: id, segmentId: id, documentName: id, content: 'Authorized return window: seventeen days.', score: 1 }));
  let models: any, messages: any, conversations: any, tools: any, service: AnswerService;
  beforeEach(() => {
    models = { resolve: jest.fn(async () => model), generate: jest.fn() };
    messages = { find: jest.fn(async () => [{ id: 'current', role: 'user', content: 'Return window?' }]) };
    conversations = { update: jest.fn() };
    tools = { run: jest.fn(async () => []) };
    service = new AnswerService(models, conversations, messages, tools);
  });
  it('returns only actually referenced sources and scopes history to the current conversation', async () => {
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any) => {
      await build(model); return { text: 'Seventeen days. [2]' };
    });
    const result = await service.answer(robot, { id: 'current-conversation' } as any, 'Return window?', evidence);
    expect(result.citations.map(c => c.documentId)).toEqual(['b']);
    expect(messages.find).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: 'current-conversation' } }));
  });
  it('injects only the current robot personality, tone and format into answer generation', async () => {
    const prompts: string[] = [];
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any) => {
      const prompt = await build(model); prompts.push(prompt[0].content);
      return { text: 'Seventeen days. [1]' };
    });
    await service.answer({ ...robot, ragConfig: { ...robot.ragConfig, personality: '耐心可靠', tone: '亲切自然', responseFormat: '先一句话给结论' } }, { id: 'one' } as any, 'Return window?', evidence);
    await service.answer(robot, { id: 'two' } as any, 'Return window?', evidence);
    expect(prompts[0]).toContain('耐心可靠');
    expect(prompts[0]).toContain('亲切自然');
    expect(prompts[0]).toContain('先一句话给结论');
    expect(prompts[1]).not.toContain('耐心可靠');
  });
  it.each([false, true])('answers using authorized knowledge when compression fails=%s', async fail => {
    const history = Array.from({ length: 7 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(300) }));
    messages.find.mockResolvedValue([...history].reverse());
    let answerPrompt = '';
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any, context: any) => {
      const prompt = await build(model);
      if (context.operation === 'compression') {
        if (fail) throw new Error('summary provider unavailable');
        return { text: 'Summary of this conversation.' };
      }
      answerPrompt = prompt[1].content;
      return { text: 'Seventeen days. [1]' };
    });
    const result = await service.answer(robot, { id: 'current' } as any, 'Return window?', evidence);
    expect(result.compressed).toBe(!fail);
    expect(answerPrompt).toContain('Authorized return window: seventeen days.');
    expect(conversations.update).toHaveBeenCalledTimes(fail ? 0 : 1);
  });
  it('rejects invented citation numbers', async () => {
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any) => {
      await build(model); return { text: 'Claim [9]' };
    });
    await expect(service.answer(robot, { id: 'current' } as any, 'Question', evidence)).rejects.toThrow('引用校验失败');
  });
  it('answers from the executed tool result even when there are no knowledge hits', async () => {
    tools.run.mockResolvedValue([{ datasetId: '', documentId: 'order-tool', segmentId: '', documentName: '工具：订单查询', content: '{"status":"已发货"}', score: 1 }]);
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any, context: any) => {
      const prompt = await build(model);
      expect(prompt.map((m: any) => m.content).join('\n')).toContain('已发货');
      return { text: context.operation === 'grounding' ? '{"supported":true}' : JSON.stringify({ sufficient: true, points: [{ text: '订单已发货。', citations: [{ source: 1, quote: '已发货' }] }] }), attempts: [] };
    });
    const result = await service.answer({ ...robot, ragConfig: { ...robot.ragConfig, toolsEnabled: true, answerMode: 'grounded_summary' } }, { id: 'current' } as any, '订单怎么样了', [], ['order'], ['客服']);
    expect(tools.run).toHaveBeenCalledWith(expect.anything(), '订单怎么样了', ['order'], ['客服']);
    expect(result.text).toBe('订单已发货。[1]');
    expect(result.citations[0].documentId).toBe('order-tool');
  });
  it('uses the concise contract in both chapter generation and repair', async () => {
    const prompts: string[] = [];
    let calls = 0;
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any, context: any) => {
      const prompt = await build(model);
      if (context.operation === 'grounding') return { text: '{"supported":true}' };
      prompts.push(prompt.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n'));
      calls++;
      return { text: JSON.stringify({ sufficient: true, points: Array.from({ length: calls === 1 ? 4 : 1 }, () => ({ text: '完成试炼。', citations: [{ source: 1, quote: evidence[0].content }] })) }), attempts: [] };
    });
    const result = await service.answer({ ...robot, ragConfig: { ...robot.ragConfig, answerMode: 'grounded_summary' } }, { id: 'current' } as any, '第一章主角做了哪些事', evidence);
    expect(result.text).toBe('完成试炼。[1]');
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('最多3个要点，正文合计不超过220字');
      expect(prompt).not.toContain('最多八点');
    }
  });
  it('enforces the final Top K even when no independent rerank model is configured', async () => {
    const result = await service.rerank({ ...robot, ragConfig: { topK: 1 } } as any, 'question', evidence);
    expect(result).toEqual([evidence[0]]);
  });
  it('expands identity vocabulary without inventing an answer or making another model call', async () => {
    const queries = await service.expandQueries(robot, '主角是谁');
    expect(queries[0]).toBe('主角是谁');
    expect(queries[1]).toContain('名字');
    expect(queries[1]).toContain('ID');
    expect(models.generate).not.toHaveBeenCalled();
  });
  it('cites the actual adjacent sentence used in the quote, not the original retrieval anchor', async () => {
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any) => {
      await build(model); return { text: JSON.stringify({ sufficient: true, extracts: [{ source: 1, quote: 'My name is Lin.\nWelcome.' }] }) };
    });
    const contextSegments = [{ id: 'identity', content: 'My name is Lin.' }, { id: 'greeting', content: 'Welcome.' }, { id: 'anchor', content: 'It was a good name.' }];
    const result = await service.answer({ ...robot, ragConfig: { ...robot.ragConfig, strictEvidence: true } } as any, { id: 'c' } as any, 'Name?', [{ ...evidence[0], segmentId: 'anchor', content: contextSegments.map(s => s.content).join('\n'), contextSegmentIds: contextSegments.map(s => s.id), contextSegments }]);
    expect(result.citations[0]).toMatchObject({ segmentId: 'identity', contextSegmentIds: ['identity', 'greeting'] });
  });
  it('runs the robot prompt and current-session context for chapter summaries', async () => {
    const chapterRobot: any = { ...robot, ragConfig: { ...robot.ragConfig, strictEvidence: true, answerMode: 'grounded_summary', systemPrompt: '用简短中文说明' } };
    const chapterEvidence: any[] = [1, 2].map(i => ({ ...evidence[0], segmentId: `wiki:chapter:1:${i}`, content: `原文${i}` }));
    let prompt: any;
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any, context: any) => {
      const messages = await build(model);
      if (context.operation === 'grounding') return { text: '{"supported":true}' };
      prompt = messages;
      return { text: JSON.stringify({ sufficient: true, points: [{ text: '章节概述', citations: [{ source: 1, quote: '原文1' }] }] }) };
    });
    const result = await service.answer(chapterRobot, { id: 'current-conversation' } as any, '第一章主要讲解的内容是什么？', chapterEvidence);
    expect(result.text).toBe('章节概述[1]');
    expect(prompt[0].content).toContain('用简短中文说明');
    expect(prompt[1].content).toContain('原文2');
    expect(models.generate).toHaveBeenCalledTimes(2);
    expect(messages.find).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: 'current-conversation' } }));
  });
  it('rejects a claim even with a valid quote when semantic evidence review fails', async () => {
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any, context: any) => {
      await build(model);
      return { text: context.operation === 'grounding' ? '{"supported":false}' : JSON.stringify({ sufficient: true, points: [{ text: 'Unlimited returns.', citations: [{ source: 1, quote: evidence[0].content }] }] }) };
    });
    const result = await service.answer({ ...robot, ragConfig: { ...robot.ragConfig, answerMode: 'grounded_summary' } }, { id: 'c' } as any, 'Return window?', evidence);
    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.text).not.toContain('Unlimited');
  });
  it('corrects a reviewer-rejected fact once and rechecks before returning it', async () => {
    const draft = (text: string) => JSON.stringify({ sufficient:true, points:[{text,citations:[{source:1,quote:evidence[0].content}]}] });
    const outputs = [draft('Thirty days.'), JSON.stringify({supported:false,reason:'原文为十七天，不是三十天'}), draft('Seventeen days.'), '{"supported":true}'];
    models.generate.mockImplementation(async (_t: any, _p: any, _f: any, build: any) => {
      await build(model); return {text:outputs.shift(),modelId:'p',attempts:[]};
    });
    const result = await service.answer({...robot,ragConfig:{...robot.ragConfig,answerMode:'grounded_summary'}},{id:'c'} as any,'Return window?',evidence);
    expect(result.text).toBe('Seventeen days.[1]');
    expect(result.grounded).toBe(true);
    expect(models.generate).toHaveBeenCalledTimes(4);
  });

});
