import { DingTalkCallbackController } from './dingtalk-callback.controller';

describe('DingTalkCallbackController', () => {
  const channels = { findOne: jest.fn() };
  const dingtalk = { handleHttpMessage: jest.fn(), verifyHttpSignature: jest.fn() };
  const secrets = { decryptRecord: jest.fn((config) => config) };
  const controller = new DingTalkCallbackController(channels as never, dingtalk as never, secrets as never);

  function response() {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    channels.findOne.mockResolvedValue({
      id: 'channel-1', tenantId: 'tenant-1', type: 'dingtalk', status: 'connected', isActive: true,
      config: { connection_mode: 'http', callback_token: 'callback-token', app_secret: 'app-secret' },
    });
  });

  it('routes an authenticated HTTP callback and returns a synchronous text reply', async () => {
    dingtalk.handleHttpMessage.mockResolvedValue({ processed: true, answer: '机器人回复', replied: false });
    const res = response();

    await controller.receive('channel-1', 'callback-token', undefined, undefined, { msgtype: 'text' }, res as never);

    expect(dingtalk.handleHttpMessage).toHaveBeenCalledWith('channel-1', 'tenant-1', { msgtype: 'text' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ msgtype: 'text', text: { content: '机器人回复' } });
  });

  it('rejects a callback with the wrong channel token', async () => {
    const res = response();

    await controller.receive('channel-1', 'wrong-token', undefined, undefined, {}, res as never);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dingtalk.handleHttpMessage).not.toHaveBeenCalled();
  });

  it('requires a valid DingTalk signature when signature headers are present', async () => {
    dingtalk.verifyHttpSignature.mockReturnValue(false);
    const res = response();

    await controller.receive('channel-1', 'callback-token', '1700000000000', 'bad-sign', {}, res as never);

    expect(dingtalk.verifyHttpSignature).toHaveBeenCalledWith('1700000000000', 'bad-sign', 'app-secret');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dingtalk.handleHttpMessage).not.toHaveBeenCalled();
  });
});
