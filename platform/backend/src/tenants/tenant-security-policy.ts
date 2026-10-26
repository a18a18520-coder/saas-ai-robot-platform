import { isIP } from 'net';

export type PasswordComplexity =
  'letters_numbers' | 'upper_lower_numbers' | 'upper_lower_numbers_symbols';

export interface TenantSecurityPolicy {
  passwordMinLength: number;
  passwordComplexity: PasswordComplexity;
  passwordExpiryDays: number | null;
  lockMaxAttempts: number;
  lockMinutes: number;
  sessionTimeoutMinutes: number | null;
  ipWhitelistEnabled: boolean;
  ipWhitelist: string[];
}

export const DEFAULT_TENANT_SECURITY_POLICY: TenantSecurityPolicy = {
  passwordMinLength: 10,
  passwordComplexity: 'letters_numbers',
  passwordExpiryDays: 90,
  lockMaxAttempts: 5,
  lockMinutes: 15,
  sessionTimeoutMinutes: 30,
  ipWhitelistEnabled: false,
  ipWhitelist: [],
};

const COMPLEXITY_VALUES = new Set<PasswordComplexity>([
  'letters_numbers',
  'upper_lower_numbers',
  'upper_lower_numbers_symbols',
]);

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function legacyNumber(value: unknown): number | undefined {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function normalizeIp(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function ipv4Value(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return ip
    .split('.')
    .reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

export function isValidIpRule(rule: string): boolean {
  const normalized = normalizeIp(rule);
  if (!normalized.includes('/')) return isIP(normalized) !== 0;
  const [address, prefixText, extra] = normalized.split('/');
  const prefix = Number(prefixText);
  return (
    extra === undefined &&
    isIP(address) === 4 &&
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

export function isIpAllowed(ip: string, rules: string[]): boolean {
  const normalizedIp = normalizeIp(ip);
  return rules.some((rawRule) => {
    const rule = normalizeIp(rawRule);
    if (!rule.includes('/')) return normalizedIp === rule;
    const [network, prefixText] = rule.split('/');
    const prefix = Number(prefixText);
    const addressValue = ipv4Value(normalizedIp);
    const networkValue = ipv4Value(network);
    if (addressValue === null || networkValue === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addressValue & mask) === (networkValue & mask);
  });
}

/** 兼容旧版中文选项，并统一收敛为后端可执行的安全策略。 */
export function tenantSecurityPolicy(
  config: Record<string, unknown> | undefined,
): TenantSecurityPolicy {
  const security = (config?.security ?? {}) as Record<string, unknown>;
  const switches = (security.switches ?? {}) as Record<string, unknown>;
  const legacyMinLength = legacyNumber(security.pwdMinLen);
  const legacyExpiry = String(security.pwdExpiry ?? '');
  const legacyLock = String(security.lockPolicy ?? '');
  const complexityValue = String(
    security.passwordComplexity ?? security.pwdComplexity ?? '',
  );
  const complexity: PasswordComplexity = COMPLEXITY_VALUES.has(
    complexityValue as PasswordComplexity,
  )
    ? (complexityValue as PasswordComplexity)
    : complexityValue.includes('符号')
      ? 'upper_lower_numbers_symbols'
      : complexityValue.includes('大小写')
        ? 'upper_lower_numbers'
        : DEFAULT_TENANT_SECURITY_POLICY.passwordComplexity;

  const whitelistSource = security.ipWhitelist;
  const whitelist = (
    Array.isArray(whitelistSource)
      ? whitelistSource
      : String(whitelistSource ?? '').split(/[\s,;]+/)
  )
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);

  const passwordExpiryDays =
    security.passwordExpiryDays === null || legacyExpiry === '永久'
      ? null
      : boundedNumber(
          security.passwordExpiryDays ?? legacyNumber(legacyExpiry),
          DEFAULT_TENANT_SECURITY_POLICY.passwordExpiryDays!,
          1,
          3650,
        );
  const lockDisabled =
    security.lockMaxAttempts === 0 || legacyLock === '不锁定';
  const sessionEnabled =
    security.sessionTimeoutMinutes !== null &&
    switches.sessionTimeout !== false;

  return {
    passwordMinLength: Math.max(
      10,
      boundedNumber(
        security.passwordMinLength ?? legacyMinLength,
        DEFAULT_TENANT_SECURITY_POLICY.passwordMinLength,
        8,
        128,
      ),
    ),
    passwordComplexity: complexity,
    passwordExpiryDays,
    lockMaxAttempts: lockDisabled
      ? 0
      : boundedNumber(
          security.lockMaxAttempts ?? legacyNumber(legacyLock),
          DEFAULT_TENANT_SECURITY_POLICY.lockMaxAttempts,
          1,
          20,
        ),
    lockMinutes: boundedNumber(
      security.lockMinutes ??
        (legacyLock.match(/锁\s*(\d+)/)?.[1]
          ? Number(legacyLock.match(/锁\s*(\d+)/)?.[1])
          : undefined),
      DEFAULT_TENANT_SECURITY_POLICY.lockMinutes,
      1,
      1440,
    ),
    sessionTimeoutMinutes: sessionEnabled
      ? boundedNumber(
          security.sessionTimeoutMinutes,
          DEFAULT_TENANT_SECURITY_POLICY.sessionTimeoutMinutes!,
          5,
          1440,
        )
      : null,
    ipWhitelistEnabled:
      security.ipWhitelistEnabled === true || switches.ipWhitelist === true,
    ipWhitelist: [...new Set(whitelist)],
  };
}

export function passwordPolicyError(
  value: unknown,
  policy: TenantSecurityPolicy,
): string | null {
  if (typeof value !== 'string' || value.length > 128)
    return `密码需为 ${policy.passwordMinLength}-128 位`;
  if (value.length < policy.passwordMinLength)
    return `密码需为 ${policy.passwordMinLength}-128 位`;
  if (!/[a-z]/i.test(value) || !/\d/.test(value))
    return '密码必须同时包含字母和数字';
  if (
    policy.passwordComplexity !== 'letters_numbers' &&
    (!/[a-z]/.test(value) || !/[A-Z]/.test(value))
  )
    return '密码必须同时包含大写字母、小写字母和数字';
  if (
    policy.passwordComplexity === 'upper_lower_numbers_symbols' &&
    !/[^A-Za-z0-9]/.test(value)
  )
    return '密码必须包含大写字母、小写字母、数字和符号';
  return null;
}

export function isPasswordExpired(
  passwordChangedAt: Date | undefined,
  createdAt: Date | undefined,
  policy: TenantSecurityPolicy,
  now = new Date(),
): boolean {
  if (!policy.passwordExpiryDays) return false;
  const changedAt = passwordChangedAt ?? createdAt;
  if (!changedAt) return false;
  return (
    now.getTime() - new Date(changedAt).getTime() >=
    policy.passwordExpiryDays * 24 * 60 * 60 * 1000
  );
}

export function serializeTenantSecurityPolicy(
  input: Record<string, unknown>,
): TenantSecurityPolicy {
  const policy = tenantSecurityPolicy({ security: input });
  const invalidRules = policy.ipWhitelist.filter(
    (rule) => !isValidIpRule(rule),
  );
  if (invalidRules.length)
    throw new Error(`IP 白名单格式无效：${invalidRules.join('、')}`);
  if (policy.ipWhitelistEnabled && policy.ipWhitelist.length === 0)
    throw new Error('启用 IP 白名单前至少填写一个 IP 或 IPv4 CIDR');
  return policy;
}
