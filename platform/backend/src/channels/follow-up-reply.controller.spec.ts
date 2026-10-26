import { FollowUpReplyController } from './follow-up-reply.controller';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { Channel } from './channel.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
function setup() {
  const item: any = { id: 'f', tenantId: 't', channel: 'dingtalk', chatId: 'group', robotId: 'robot', delivery: { channelId: 'c' }, resolution: { answer: '人工答案' }, question: '问题' };
  const manager = { findOne: jest.fn(async (type: any, opts: any) => type === FollowUp ? opts.where.tenantId === item.tenantId ? item : null : type === Channel ? { id: 'c' } : type === Conversation ? { id: 'conversation', robotId: 'robot' } : { robotId: 'robot' }), create: jest.fn((_type: any, data: any) => data), save: jest.fn(async (row: any) => row), update: jest.fn(async (_: any, __: any, patch: any) => Object.assign(item, patch)) };
  const repo: any = { manager: { ...manager, transaction: (fn: any) => fn(manager) }, update: jest.fn(async (_: any, patch: any) => Object.assign(item, patch)) };
  const ding = { sendToGroup: jest.fn(async () => true) };
  return { item, manager, ding, controller: new FollowUpReplyController(repo, ding as any), req: { auth: { sub: 'operator' } } as any };
}
it('sends the saved answer to the original group once', async () => {
  const f = setup();
  await f.controller.reply('t', 'f', f.req);
  await f.controller.reply('t', 'f', f.req);
  expect(f.ding.sendToGroup).toHaveBeenCalledTimes(1);
  expect(f.ding.sendToGroup).toHaveBeenCalledWith('c', 't', 'group', expect.stringContaining('人工答案'));
  expect(f.item.delivery.state).toBe('sent');
});
it('rejects foreign tenant and changed group robot without sending', async () => {
  const f = setup();
  await expect(f.controller.reply('foreign', 'f', f.req)).rejects.toThrow();
  f.item.robotId = 'other';
  await expect(f.controller.reply('t', 'f', f.req)).rejects.toThrow('绑定已变更');
  expect(f.ding.sendToGroup).not.toHaveBeenCalled();
});
it('keeps an explicit failure retryable', async () => {
  const f = setup(); f.ding.sendToGroup.mockResolvedValueOnce(false);
  await expect(f.controller.reply('t', 'f', f.req)).rejects.toThrow('发送失败');
  expect(f.item.delivery.state).toBe('failed');
  await f.controller.reply('t', 'f', f.req);
  expect(f.item.delivery.state).toBe('sent');
});
it('does not automatically resend an uncertain timeout', async () => {
  const f = setup(); f.ding.sendToGroup.mockRejectedValueOnce(new Error('timeout'));
  await expect(f.controller.reply('t', 'f', f.req)).rejects.toThrow('不确定');
  await expect(f.controller.reply('t', 'f', f.req)).rejects.toThrow('待核对');
  expect(f.ding.sendToGroup).toHaveBeenCalledTimes(1);
});

it('allows manual recovery of interrupted sends only after the waiting period', async () => {
  const f = setup(); f.item.delivery = { channelId: 'c', state: 'sending', attemptId: 'old', startedAt: new Date().toISOString() };
  await expect(f.controller.confirm('t', 'f', f.req, { received: false })).rejects.toThrow('五分钟');
  f.item.delivery.startedAt = new Date(Date.now() - 360000).toISOString();
  await f.controller.confirm('t', 'f', f.req, { received: false });
  expect(f.item.delivery.state).toBe('failed');
  expect(f.item.delivery.attemptId).not.toBe('old');
  expect(f.ding.sendToGroup).not.toHaveBeenCalled();
});
it('does not overwrite manual reconciliation with a late send completion', async () => {
  const f = setup();
  f.manager.save.mockImplementation(async (row: any) => structuredClone(row));
  let finish!: (value: boolean) => void;
  f.ding.sendToGroup.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const pending = f.controller.reply('t', 'f', f.req);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.item.delivery.startedAt = new Date(Date.now() - 360000).toISOString();
  await f.controller.confirm('t', 'f', f.req, { received: false });
  finish(true);
  await pending;
  expect(f.item.delivery.state).toBe('failed');
  expect(f.manager.update).not.toHaveBeenCalled();
});

it('records a manually confirmed delivery in the original conversation exactly once', async () => {
  const f = setup();
  f.item.delivery = { channelId: 'c', conversationId: 'conversation', state: 'uncertain', attemptId: 'old' };
  await f.controller.confirm('t', 'f', f.req, { received: true });
  expect(f.manager.findOne).toHaveBeenCalledWith(Conversation, { where: { id: 'conversation', tenantId: 't', robotId: 'robot' } });
  expect(f.manager.save).toHaveBeenCalledWith(Message, expect.objectContaining({
    conversationId: 'conversation', role: 'human', content: '人工答案',
    metadata: expect.objectContaining({ sent: true, manuallyConfirmed: true }),
  }));
  await expect(f.controller.confirm('t', 'f', f.req, { received: true })).rejects.toThrow('无需核对');
  expect(f.manager.create).toHaveBeenCalledTimes(1);
  expect(f.ding.sendToGroup).not.toHaveBeenCalled();
});
it('does not record a reply when the operator confirms it was not received', async () => {
  const f = setup();
  f.item.delivery = { channelId: 'c', conversationId: 'conversation', state: 'uncertain' };
  await f.controller.confirm('t', 'f', f.req, { received: false });
  expect(f.manager.create).not.toHaveBeenCalled();
  expect(f.item.delivery.state).toBe('failed');
});
it('does not write to a missing or foreign conversation on confirmation', async () => {
  const f = setup();
  f.item.delivery = { channelId: 'c', conversationId: 'foreign', state: 'uncertain' };
  const original = f.manager.findOne.getMockImplementation()!;
  f.manager.findOne.mockImplementation(async (type: any, opts: any) => type === Conversation ? null : original(type, opts));
  await f.controller.confirm('t', 'f', f.req, { received: true });
  expect(f.manager.create).not.toHaveBeenCalled();
  expect(f.item.delivery.state).toBe('sent');
});
