import { HttpException } from '@nestjs/common';
import { LoginAttemptLimiter } from './login-attempt-limiter.service';

describe('LoginAttemptLimiter', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(1_000_000));
  afterEach(() => jest.restoreAllMocks());

  it('在连续失败达到阈值后同时锁定账号和 IP', () => {
    const limiter = new LoginAttemptLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      lockMs: 30_000,
    });
    for (let i = 0; i < 3; i++)
      limiter.recordFailure('tenant', 'Admin@Example.com', '10.0.0.1');

    expect(() =>
      limiter.assertAllowed('tenant', 'admin@example.com', '10.0.0.2'),
    ).toThrow(HttpException);
    expect(() =>
      limiter.assertAllowed('tenant', 'other@example.com', '10.0.0.1'),
    ).toThrow(HttpException);
  });

  it('成功登录后重置当前账号与 IP 计数', () => {
    const limiter = new LoginAttemptLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
      lockMs: 30_000,
    });
    limiter.recordFailure('platform', 'admin@example.com', '10.0.0.1');
    limiter.reset('platform', 'admin@example.com', '10.0.0.1');
    expect(() =>
      limiter.assertAllowed('platform', 'admin@example.com', '10.0.0.1'),
    ).not.toThrow();
  });

  it('锁定到期后可再次尝试', () => {
    const limiter = new LoginAttemptLimiter({
      maxAttempts: 1,
      windowMs: 60_000,
      lockMs: 30_000,
    });
    limiter.recordFailure('tenant', 'admin@example.com', '10.0.0.1');
    jest.spyOn(Date, 'now').mockReturnValue(1_030_001);
    expect(() =>
      limiter.assertAllowed('tenant', 'admin@example.com', '10.0.0.1'),
    ).not.toThrow();
  });

  it('平台重置密码后仅解除账号锁定，保留可疑 IP 锁定', () => {
    const limiter = new LoginAttemptLimiter({
      maxAttempts: 1,
      windowMs: 60_000,
      lockMs: 30_000,
    });
    limiter.recordFailure('tenant', 'admin@example.com', '10.0.0.1');
    limiter.resetAccount('tenant', 'Admin@Example.com');

    expect(() =>
      limiter.assertAllowed('tenant', 'admin@example.com', '10.0.0.2'),
    ).not.toThrow();
    expect(() =>
      limiter.assertAllowed('tenant', 'other@example.com', '10.0.0.1'),
    ).toThrow(HttpException);
  });

  it('支持租户级失败次数策略，并允许显式关闭账号锁定', () => {
    const limiter = new LoginAttemptLimiter();
    const strictPolicy = {
      maxAttempts: 2,
      windowMs: 60_000,
      lockMs: 30_000,
    };
    limiter.recordFailure(
      'tenant',
      'strict@example.com',
      '10.0.0.8',
      strictPolicy,
    );
    limiter.recordFailure(
      'tenant',
      'strict@example.com',
      '10.0.0.8',
      strictPolicy,
    );
    expect(() =>
      limiter.assertAllowed(
        'tenant',
        'strict@example.com',
        '10.0.0.9',
        strictPolicy,
      ),
    ).toThrow(HttpException);

    const disabledPolicy = { ...strictPolicy, maxAttempts: 0 };
    expect(() =>
      limiter.assertAllowed(
        'tenant',
        'strict@example.com',
        '10.0.0.9',
        disabledPolicy,
      ),
    ).not.toThrow();
  });
});
