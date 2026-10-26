import { ServiceUnavailableException } from '@nestjs/common';
import { ActivationEmailService } from './activation-email.service';

describe('ActivationEmailService', () => {
  it('SMTP 未配置时明确失败，不伪装已发送', async () => {
    const config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    await expect(new ActivationEmailService(config as any).send('a@example.com', '测试租户', 'https://example.com/activate'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
