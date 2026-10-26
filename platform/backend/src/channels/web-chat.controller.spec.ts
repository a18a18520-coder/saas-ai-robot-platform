import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebChatController } from './web-chat.controller';

describe('WebChatController channel access', () => {
  const router = { handleMessage: jest.fn() };
  const channels = { findOne: jest.fn() };
  let controller: WebChatController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebChatController(router as never, channels as never);
    channels.findOne.mockResolvedValue({
      id: 'web-1', tenantId: 'tenant-1', type: 'web', status: 'connected', isActive: true,
      bindRobotId: 'robot-1', config: { site_key: 'site-key-123', domains: 'https://www.example.com' },
    });
    router.handleMessage.mockResolvedValue({ processed: true, answer: '你好' });
  });

  it('routes an allowed site through the channel-bound tenant and robot', async () => {
    const result = await controller.chat({
      channelId: 'web-1', siteKey: 'site-key-123', siteOrigin: 'https://www.example.com', visitorId: 'visitor-1', content: '你好',
    });

    expect(router.handleMessage).toHaveBeenCalledWith({
      tenantId: 'tenant-1', channel: 'web', channelUserId: 'visitor-1', robotId: 'robot-1', isAtRobot: true, content: '你好',
    });
    expect(result.data).toEqual({ processed: true, answer: '你好' });
  });

  it('hides a channel when its public site key is wrong', async () => {
    await expect(controller.chat({
      channelId: 'web-1', siteKey: 'wrong-key', siteOrigin: 'https://www.example.com', visitorId: 'visitor-1', content: '你好',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(router.handleMessage).not.toHaveBeenCalled();
  });

  it('blocks parent sites outside the configured allowlist', async () => {
    await expect(controller.chat({
      channelId: 'web-1', siteKey: 'site-key-123', siteOrigin: 'https://evil.example', visitorId: 'visitor-1', content: '你好',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(router.handleMessage).not.toHaveBeenCalled();
  });
});
