import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/** 密码哈希：scrypt（随机盐内嵌）—— 格式 scrypt$salt$hash。 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const calculated = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return (
    calculated.length === expected.length &&
    timingSafeEqual(calculated, expected)
  );
}
