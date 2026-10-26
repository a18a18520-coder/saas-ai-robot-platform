const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function booleanEnv(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

export function parseAllowedOrigins(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function validEncryptionKey(value: string): boolean {
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

/** Nest ConfigModule startup validation. Production fails closed on unsafe defaults. */
export function validateEnvironment(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const env = { ...raw };
  const nodeEnv = String(env.NODE_ENV ?? 'development');
  const production = nodeEnv === 'production';
  const port = Number(env.PORT ?? 3000);
  const dbPort = Number(env.DB_PORT ?? 5432);
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  const errors: string[] = [];

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.push('PORT 必须是 1-65535 的整数');
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535)
    errors.push('DB_PORT 必须是 1-65535 的整数');
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 10
  )
    errors.push('TRUST_PROXY_HOPS 必须是 0-10 的整数');
  const encryptionKey = String(env.APP_ENCRYPTION_KEY ?? '');
  if (!encryptionKey)
    errors.push('缺少 APP_ENCRYPTION_KEY（开发与生产环境均必填）');
  else if (!validEncryptionKey(encryptionKey))
    errors.push(
      'APP_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制字符串',
    );
  const previousEncryptionKey = String(env.APP_ENCRYPTION_KEY_PREVIOUS ?? '');
  if (previousEncryptionKey && !validEncryptionKey(previousEncryptionKey)) {
    errors.push(
      'APP_ENCRYPTION_KEY_PREVIOUS 必须是 32 字节 Base64 或 64 位十六进制字符串',
    );
  }

  if (production) {
    const required = [
      'DB_HOST',
      'DB_USER',
      'DB_PASS',
      'DB_NAME',
      'JWT_SECRET',
      'CORS_ORIGINS',
      'PLATFORM_SUPER_ADMIN_EMAIL',
      'PLATFORM_SUPER_ADMIN_PASSWORD',
    ];
    for (const key of required) {
      if (!String(env[key] ?? '').trim()) errors.push(`生产环境缺少 ${key}`);
    }
    if (booleanEnv(env.DB_SYNC, false))
      errors.push('生产环境禁止 DB_SYNC=true，请执行数据库迁移');
    if (String(env.JWT_SECRET ?? '').length < 32)
      errors.push('生产环境 JWT_SECRET 至少 32 个字符');
    if (String(env.DB_PASS ?? '') === 'robot')
      errors.push('生产环境不得使用默认数据库密码');
    const platformPassword = String(env.PLATFORM_SUPER_ADMIN_PASSWORD ?? '');
    if (
      platformPassword.length < 10 ||
      !/[a-z]/i.test(platformPassword) ||
      !/\d/.test(platformPassword)
    ) {
      errors.push('平台超管密码至少 10 位，且必须同时包含字母和数字');
    }
    const origins = parseAllowedOrigins(String(env.CORS_ORIGINS ?? ''));
    if (origins.includes('*')) errors.push('CORS_ORIGINS 不得包含通配符 *');
    for (const origin of origins) {
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin)
          errors.push(`CORS_ORIGINS 必须填写完整 origin：${origin}`);
      } catch {
        errors.push(`CORS_ORIGINS 格式无效：${origin}`);
      }
    }
  }

  if (errors.length)
    throw new Error(`环境配置校验失败：\n- ${errors.join('\n- ')}`);
  env.NODE_ENV = nodeEnv;
  env.PORT = port;
  env.DB_PORT = dbPort;
  env.TRUST_PROXY_HOPS = trustProxyHops;
  env.DB_SYNC = String(booleanEnv(env.DB_SYNC, false));
  return env;
}
