import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { DingTalkService } from './dingtalk.service';

describe('DingTalkService Stream messages', () => {
  const channels = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(async (value) => value) };
  const router = { handleMessage: jest.fn() };
  const groupRegistration = { register: jest.fn() };
  const groupMembers = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const identity = { resolve: jest.fn() };
  const secrets = { decryptRecord: jest.fn((config) => config) };
  let service: DingTalkService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DingTalkService(channels as never, router as never, groupRegistration as never, groupMembers as never, identity as never, secrets as never);
    router.handleMessage.mockResolvedValue({ processed: false });
    groupRegistration.register.mockResolvedValue({ id: 'group-1' });
    groupMembers.findOne.mockResolvedValue(null);
    identity.resolve.mockResolvedValue({ user: { id: 'user-1' } });
    channels.findOne.mockResolvedValue({
      id: 'channel-1', tenantId: 'tenant-1', type: 'dingtalk', bindRobotId: 'robot-1',
      config: { app_key: 'app-key', app_secret: 'app-secret', robot_code: 'robot-code' },
    });
  });

  it('parses the SDK root payload and treats robot callbacks as an explicit mention', async () => {
    await (service as unknown as { handleRobotMessage: (channelId: string, tenantId: string, message: unknown) => Promise<void> }).handleRobotMessage(
      'channel-1',
      'tenant-1',
      {
        headers: { topic: '/v1.0/im/bot/messages/get' },
        data: JSON.stringify({
          msgtype: 'text', text: { content: ' 查询制度 ' }, conversationId: 'cid-1', conversationTitle: '制度群',
          senderStaffId: 'user-1', senderNick: '张三', conversationType: '2',
        }),
      },
    );

    expect(groupRegistration.register).toHaveBeenCalledWith({ tenantId: 'tenant-1', channel: 'dingtalk', chatId: 'cid-1', name: '制度群' });
    expect(identity.resolve).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', channel: 'dingtalk', channelUserId: 'user-1', displayName: '张三',
    }));
    expect(groupMembers.save).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1', channelUserId: 'user-1', userId: 'user-1', source: 'dingtalk',
    }));
    expect(router.handleMessage).toHaveBeenCalledWith({
      tenantId: 'tenant-1', channelId: 'channel-1', channel: 'dingtalk', channelUserId: 'user-1', chatId: 'cid-1', isAtRobot: true, content: '查询制度',
    });
  });

  it('notifies matching group staff and retains the ticket for follow-up', async () => {
    router.handleMessage.mockResolvedValue({ processed: true, answer: '待跟进', handoffId: 'ticket' });
    const manager = { findOne: jest.fn().mockResolvedValueOnce({ id: 'g', handoffRole: '客服' }).mockResolvedValueOnce({ role: '客服' }), query: jest.fn() };
    Object.assign(groupMembers, { manager, find: jest.fn(async () => [{ userId: 'staff', channelUserId: 'staff-ding' }]) });
    const send = jest.spyOn(service as any, 'sendSessionReply').mockResolvedValue(true);
    await (service as any).handleRobotMessage('channel-1', 'tenant-1', { headers: {}, data: JSON.stringify({ msgtype: 'text', text: { content: '未知问题' }, conversationId: 'cid', senderStaffId: 'user-1', conversationType: '2', sessionWebhook: 'https://oapi.dingtalk.com/robot/send?test' }) });
    expect(send).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('人工处理'), ['staff-ding']);
    expect(manager.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['ticket', 'tenant-1']));
    send.mockRestore();
  });

  it('subscribes to the robot CALLBACK topic instead of the ordinary event stream', async () => {
    const register = jest.spyOn(DWClient.prototype, 'registerCallbackListener').mockReturnThis();
    const connect = jest.spyOn(DWClient.prototype, 'connect').mockImplementation(async function (this: DWClient) { this.connected = true; });

    await service.start('channel-1', 'tenant-1');

    expect(register).toHaveBeenCalledWith(TOPIC_ROBOT, expect.any(Function));
    connect.mockRestore();
    register.mockRestore();
  });

  it('rejects an SDK connection that resolves while offline', async () => {
    const connect = jest.spyOn(DWClient.prototype, 'connect').mockResolvedValue();
    await expect(service.start('channel-1', 'tenant-1')).rejects.toThrow('连接未建立');
    expect(service.isConnected('channel-1')).toBe(false);
    connect.mockRestore();
  });
  it('shares concurrent start attempts and disables competing SDK retries', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const connect = jest.spyOn(DWClient.prototype, 'connect').mockImplementation(async function (this: DWClient) {
      expect(this.config.autoReconnect).toBe(false);
      expect(this.config.keepAlive).toBe(true);
      await gate;
      this.connected = true;
    });
    const first = service.start('channel-1', 'tenant-1');
    const second = service.start('channel-1', 'tenant-1');
    release();
    try { await Promise.all([first, second]); expect(connect).toHaveBeenCalledTimes(1); }
    finally { connect.mockRestore(); service.onModuleDestroy(); }
  });

  it('enables HTTP mode without opening a Stream connection', async () => {
    channels.findOne.mockResolvedValueOnce({
      id: 'channel-http', tenantId: 'tenant-1', type: 'dingtalk', name: '钉钉 HTTP',
      config: { app_key: 'app-key', app_secret: 'app-secret', robot_code: 'robot-code', connection_mode: 'http' },
    });
    const connect = jest.spyOn(DWClient.prototype, 'connect').mockImplementation(async function (this: DWClient) { this.connected = true; });

    await service.start('channel-http', 'tenant-1');

    expect(connect).not.toHaveBeenCalled();
    connect.mockRestore();
  });

  it('returns an HTTP synchronous text answer when no reply webhook is available', async () => {
    router.handleMessage.mockResolvedValueOnce({ processed: true, answer: '同步回复' });
    jest.spyOn(service, 'sendToUser').mockResolvedValueOnce(false);

    const result = await service.handleHttpMessage('channel-1', 'tenant-1', {
      msgId: 'http-msg-1', msgtype: 'text', text: { content: '你好' }, conversationId: 'cid-http',
      senderStaffId: 'user-http', conversationType: '1',
    });

    expect(result).toEqual({ processed: true, answer: '同步回复', replied: false });
    expect(router.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', channel: 'dingtalk', channelUserId: 'user-http', robotId: 'robot-1', content: '你好',
    }));
  });

  it('verifies signed HTTP callbacks and rejects expired timestamps', () => {
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'app-secret').update(`${timestamp}\napp-secret`).digest('base64');

    expect(service.verifyHttpSignature(timestamp, signature, 'app-secret')).toBe(true);
    expect(service.verifyHttpSignature(String(Date.now() - 2 * 60 * 60 * 1000), signature, 'app-secret')).toBe(false);
  });

  it('accepts numeric conversation types and falls back to senderId', async () => {
    await (service as unknown as { handleRobotMessage: (channelId: string, tenantId: string, message: unknown) => Promise<void> }).handleRobotMessage(
      'channel-1',
      'tenant-1',
      {
        headers: { topic: TOPIC_ROBOT },
        data: JSON.stringify({
          msgType: 'text', text: { content: '你好' }, conversationId: 'cid-external', senderId: 'external-1', conversationType: 2,
        }),
      },
    );

    expect(groupRegistration.register).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'cid-external' }));
    expect(identity.resolve).toHaveBeenCalledWith(expect.objectContaining({ channelUserId: 'external-1' }));
  });

  it('routes direct messages to the robot bound to the channel', async () => {
    await (service as unknown as { handleRobotMessage: (channelId: string, tenantId: string, message: unknown) => Promise<void> }).handleRobotMessage(
      'channel-1', 'tenant-1',
      { headers: {}, data: JSON.stringify({ msgtype: 'text', text: { content: '你好' }, conversationId: 'cid-1', senderStaffId: 'user-1', conversationType: '1' }) },
    );
    expect(router.handleMessage).toHaveBeenCalledWith({
      tenantId: 'tenant-1', channelId: 'channel-1', channel: 'dingtalk', channelUserId: 'user-1', chatId: undefined,
      robotId: 'robot-1', isAtRobot: true, content: '你好',
    });
    expect(identity.resolve).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', channel: 'dingtalk', channelUserId: 'user-1',
    }));
    expect(groupRegistration.register).not.toHaveBeenCalled();
  });

  it('uses the current proactive group-message request contract', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ json: async () => ({ accessToken: 'access-token', expireIn: 7200 }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ processQueryKey: 'query-1' }) } as Response);

    await expect(service.sendToGroup('channel-1', 'tenant-1', 'cid-1', '制度通知')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': 'access-token' },
        body: JSON.stringify({
          robotCode: 'robot-code', openConversationId: 'cid-1', msgKey: 'sampleText', msgParam: JSON.stringify({ content: '制度通知' }),
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('uses the DingTalk batch-send contract for direct-message fallback', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ json: async () => ({ accessToken: 'access-token', expireIn: 7200 }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ processQueryKey: 'query-oto' }) } as Response);

    await expect(service.sendToUser('channel-1', 'tenant-1', 'staff-1', '单聊回复')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
      expect.objectContaining({
        body: JSON.stringify({
          robotCode: 'robot-code', userIds: ['staff-1'], msgKey: 'sampleText', msgParam: JSON.stringify({ content: '单聊回复' }),
        }),
      }),
    );
    fetchMock.mockRestore();
  });
});

describe('DingTalk connection recovery and delivery failures', () => {
  it('replaces a stale connected socket after a sleep-sized timer gap', async () => {
    const channels = { find: jest.fn(async () => [{ id: 'c', tenantId: 't' }]) };
    const service = new DingTalkService(channels as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    (service as any).clients.set('c', { connected: true });
    (service as any).lastRestoreCheck = Date.now() - 120_000;
    const stop = jest.spyOn(service, 'stop').mockResolvedValue();
    const start = jest.spyOn(service, 'start').mockResolvedValue();
    await (service as any).restoreConnections();
    expect(stop).toHaveBeenCalledWith('c');
    expect(start).toHaveBeenCalledWith('c', 't');
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    stop.mockClear();
    await (service as any).restoreConnections();
    expect(stop).not.toHaveBeenCalled();
  });
  it.each(['stop', 'destroy'])('handles the real SDK asynchronous CONNECTING-socket error on %s', async operation => {
    const service = new DingTalkService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const client = new DWClient({ clientId: 'test', clientSecret: 'test' });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; terminate: jest.Mock };
    socket.readyState = 0;
    socket.on('error', () => undefined); // SDK cleanup removes this listener.
    socket.terminate = jest.fn(() => process.nextTick(() => socket.emit('error', new Error('WebSocket was closed before the connection was established'))));
    (client as any).socket = socket;
    (service as any).clients.set('c', client);
    if (operation === 'stop') await service.stop('c'); else service.onModuleDestroy();
    await new Promise(resolve => setImmediate(resolve));
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(service.isConnected('c')).toBe(false);
  });
  it('keeps an enabled channel enabled after transient reconnect failure', async () => {
    const channel = { id: 'c', tenantId: 't', name: '客服', status: 'connected', isActive: true };
    const channels = { find: jest.fn().mockResolvedValue([channel]), save: jest.fn() };
    const service = new DingTalkService(channels as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(service, 'start').mockRejectedValueOnce(new Error('TLS disconnected')).mockResolvedValueOnce();
    await (service as any).restoreConnections();
    expect(channel.isActive).toBe(true);
    expect(channels.save).not.toHaveBeenCalled();
    await (service as any).restoreConnections();
    expect(service.start).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
  it('does not report a DingTalk HTTP 200 business error as delivered', async () => {
    const service = new DingTalkService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ errcode: 40014 }) } as Response);
    try { expect(await (service as any).sendSessionReply('https://oapi.dingtalk.com/robot/send', 'answer')).toBe(false); }
    finally { fetchMock.mockRestore(); }
  });
  it('accepts an empty successful session webhook response', async () => {
    const service = new DingTalkService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response);
    try { expect(await (service as any).sendSessionReply('https://oapi.dingtalk.com/robot/send', 'answer')).toBe(true); }
    finally { fetchMock.mockRestore(); }
  });
});
