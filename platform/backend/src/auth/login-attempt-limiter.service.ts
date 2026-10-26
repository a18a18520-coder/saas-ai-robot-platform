import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';

interface AttemptBucket {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
}

export interface LoginAttemptPolicy {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}

const DEFAULT_POLICY: LoginAttemptPolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

export const LOGIN_ATTEMPT_POLICY = Symbol('LOGIN_ATTEMPT_POLICY');

/**
 * 登录防爆破：同时限制账号维度与 IP 维度，避免通过更换账号或地址绕过。
 * 记录仅保存摘要键和计数，不保存密码或令牌。
 */
@Injectable()
export class LoginAttemptLimiter {
  private readonly buckets = new Map<string, AttemptBucket>();
  private readonly policy: LoginAttemptPolicy;

  constructor(
    @Optional() @Inject(LOGIN_ATTEMPT_POLICY) policy?: LoginAttemptPolicy,
  ) {
    this.policy = policy ?? DEFAULT_POLICY;
  }

  assertAllowed(
    domain: 'platform' | 'tenant',
    account: string | undefined,
    ip: string,
    policy?: LoginAttemptPolicy,
  ): void {
    if (policy?.maxAttempts === 0) return;
    const now = Date.now();
    this.purge(now);
    const blockedUntil = Math.max(
      ...this.keys(domain, account, ip).map(
        (key) => this.buckets.get(key)?.blockedUntil ?? 0,
      ),
    );
    if (blockedUntil <= now) return;
    const retryAfter = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    throw new HttpException(
      {
        code: 42901,
        message: `登录失败次数过多，请 ${retryAfter} 秒后重试`,
        data: { retryAfter },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(
    domain: 'platform' | 'tenant',
    account: string | undefined,
    ip: string,
    policy?: LoginAttemptPolicy,
  ): void {
    const effectivePolicy = policy ?? this.policy;
    if (effectivePolicy.maxAttempts === 0) return;
    const now = Date.now();
    for (const key of this.keys(domain, account, ip)) {
      const current = this.buckets.get(key);
      const bucket =
        !current || now - current.windowStartedAt >= effectivePolicy.windowMs
          ? {
              failures: 0,
              windowStartedAt: now,
              blockedUntil: 0,
              lastSeenAt: now,
            }
          : current;
      bucket.failures += 1;
      bucket.lastSeenAt = now;
      if (bucket.failures >= effectivePolicy.maxAttempts)
        bucket.blockedUntil = now + effectivePolicy.lockMs;
      this.buckets.set(key, bucket);
    }
  }

  reset(
    domain: 'platform' | 'tenant',
    account: string | undefined,
    ip: string,
  ): void {
    for (const key of this.keys(domain, account, ip)) this.buckets.delete(key);
  }

  /** 管理员重置密码后解除该账号维度的锁定，不影响可疑 IP 的防护。 */
  resetAccount(
    domain: 'platform' | 'tenant',
    account: string | undefined,
  ): void {
    const normalizedAccount = account?.trim().toLowerCase() || '<empty>';
    this.buckets.delete(`${domain}:account:${normalizedAccount}`);
  }

  private keys(
    domain: 'platform' | 'tenant',
    account: string | undefined,
    ip: string,
  ): string[] {
    const normalizedAccount = account?.trim().toLowerCase() || '<empty>';
    return [
      `${domain}:account:${normalizedAccount}`,
      `${domain}:ip:${ip || '<unknown>'}`,
    ];
  }

  private purge(now: number): void {
    const expiresAfter = this.policy.windowMs + this.policy.lockMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.blockedUntil <= now && now - bucket.lastSeenAt >= expiresAfter)
        this.buckets.delete(key);
    }
  }
}
