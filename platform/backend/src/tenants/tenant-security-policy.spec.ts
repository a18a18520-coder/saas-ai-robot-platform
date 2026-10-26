import {
  isIpAllowed,
  isPasswordExpired,
  passwordPolicyError,
  serializeTenantSecurityPolicy,
  tenantSecurityPolicy,
} from './tenant-security-policy';

describe('tenantSecurityPolicy', () => {
  it('兼容旧版中文配置并执行平台最低 10 位基线', () => {
    const policy = tenantSecurityPolicy({
      security: {
        pwdMinLen: '8 位',
        pwdComplexity: '大小写 + 数字',
        pwdExpiry: '180 天',
        lockPolicy: '10 次锁 30 分钟',
        switches: { sessionTimeout: true },
      },
    });
    expect(policy).toMatchObject({
      passwordMinLength: 10,
      passwordComplexity: 'upper_lower_numbers',
      passwordExpiryDays: 180,
      lockMaxAttempts: 10,
      lockMinutes: 30,
      sessionTimeoutMinutes: 30,
    });
  });

  it('校验复杂密码、IP 与 CIDR', () => {
    const policy = serializeTenantSecurityPolicy({
      passwordMinLength: 12,
      passwordComplexity: 'upper_lower_numbers_symbols',
      passwordExpiryDays: 90,
      lockMaxAttempts: 5,
      lockMinutes: 15,
      sessionTimeoutMinutes: 60,
      ipWhitelistEnabled: true,
      ipWhitelist: ['10.0.0.0/24', '::1'],
    });
    expect(passwordPolicyError('Short2026', policy)).not.toBeNull();
    expect(passwordPolicyError('StrongPass!2026', policy)).toBeNull();
    expect(isIpAllowed('10.0.0.42', policy.ipWhitelist)).toBe(true);
    expect(isIpAllowed('10.0.1.42', policy.ipWhitelist)).toBe(false);
    expect(isIpAllowed('::1', policy.ipWhitelist)).toBe(true);
  });

  it('拒绝开启空白名单，并按修改时间计算密码到期', () => {
    expect(() =>
      serializeTenantSecurityPolicy({ ipWhitelistEnabled: true }),
    ).toThrow('至少填写一个 IP');
    const policy = tenantSecurityPolicy({
      security: { passwordExpiryDays: 90 },
    });
    expect(
      isPasswordExpired(
        new Date('2026-01-01T00:00:00Z'),
        undefined,
        policy,
        new Date('2026-04-02T00:00:00Z'),
      ),
    ).toBe(true);
  });
});
