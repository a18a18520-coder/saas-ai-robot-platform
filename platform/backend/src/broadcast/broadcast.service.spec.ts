import { BadRequestException } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { BroadcastRecord } from './broadcast-record.entity';

describe('BroadcastService polling plans', () => {
  const records = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: value.id ?? 'record-1', createdAt: value.createdAt ?? new Date(), ...value })),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const groups = { find: jest.fn() };
  const channels = { findOne: jest.fn() };
  const notifications = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const audit = { log: jest.fn(async () => undefined) };
  const wecom = { sendToGroup: jest.fn() };
  const dingtalk = { sendToGroup: jest.fn() };
  const feishu = { sendExternal: jest.fn() };
  let service: BroadcastService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BroadcastService(
      records as never,
      groups as never,
      channels as never,
      notifications as never,
      audit as never,
      wecom as never,
      dingtalk as never,
      feishu as never,
    );
    groups.find.mockResolvedValue([{ id: 'group-1', tenantId: 'tenant-1', chatId: 'chat-1', channel: 'dingtalk', robotId: 'robot-1' }]);
    channels.findOne.mockResolvedValue({ id: 'channel-1', tenantId: 'tenant-1', type: 'dingtalk', status: 'connected', bindRobotId: 'robot-1' });
    dingtalk.sendToGroup.mockResolvedValue(true);
  });

  it('sends the first round immediately and persists the next round', async () => {
    const result = await service.send({
      tenantId: 'tenant-1',
      robotIds: ['robot-1'],
      groupIds: ['chat-1'],
      content: '轮询消息',
      pollIntervalMinutes: 10,
      pollCount: 3,
    });

    expect(dingtalk.sendToGroup).toHaveBeenCalledWith('channel-1', 'tenant-1', 'chat-1', '轮询消息');
    expect(result.record).toMatchObject({ status: 'SCHEDULED', completedPolls: 1, pollCount: 3, pollIntervalMinutes: 10 });
    expect(result.record.nextPollAt!.getTime()).toBeGreaterThan(result.record.lastSentAt!.getTime());
    expect(result.record.roundResults).toEqual([
      expect.objectContaining({ round: 1, results: { 'chat-1': 'ok' }, attempts: { 'chat-1': 1 } }),
    ]);
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('atomically claims and completes a due final round', async () => {
    const due = {
      id: 'record-1', tenantId: 'tenant-1', robotIds: ['robot-1'], groupIds: ['chat-1'], content: '第二轮',
      status: 'SCHEDULED', pollIntervalMinutes: 5, pollCount: 2, completedPolls: 1, results: { 'chat-1': 'ok' },
      roundResults: [], createdAt: new Date(), updatedAt: new Date(),
    } as BroadcastRecord;
    records.find.mockResolvedValue([due]);
    records.update.mockResolvedValue({ affected: 1 });

    await service.dispatchDue('tenant-1');

    expect(records.update).toHaveBeenCalledWith(
      { id: 'record-1', status: 'SCHEDULED' },
      expect.objectContaining({ status: 'SENDING' }),
    );
    expect(due).toMatchObject({ status: 'SUCCESS', completedPolls: 2, nextPollAt: null });
  });

  it('rejects unsafe polling limits before creating a record', async () => {
    await expect(service.send({
      tenantId: 'tenant-1', robotIds: ['robot-1'], groupIds: ['chat-1'], content: '消息', pollIntervalMinutes: 0, pollCount: 101,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(records.save).not.toHaveBeenCalled();
  });
});
