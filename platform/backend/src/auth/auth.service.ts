import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 独立登录系统隔离（FR-030）：
 * 平台管理员（platform 域）与租户管理员（tenant 域）独立认证体系
 *  - JWT 载荷含 domain 字段：'platform' | 'tenant'
 *  - Access 30min + Refresh 7d（Refresh 存 httpOnly Cookie）
 *  - MFA: TOTP（RFC 6238，30s 周期，6 位）
 *  - 平台首个超级管理员账号：系统启动时幂等写入数据库
 */
export interface AuthPayload {
  sub: string; // accountId
  domain: 'platform' | 'tenant';
  tenantId?: string;
  role: 'SUPER_ADMIN' | 'PLATFORM_OP' | 'TENANT_ADMIN' | 'TENANT_OP';
  roleId?: string;
  windows?: string[];
  sessionVersion?: number;
  mustChangePassword?: boolean;
  sessionTimeoutMinutes?: number;
  permissions?: string[];
  name?: string;
  roleName?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  /** 签发 Access Token（30min） */
  issueAccessToken(payload: AuthPayload, expiresInSeconds?: number): string {
    return this.jwt.sign(payload, {
      expiresIn: expiresInSeconds ?? '30m',
    });
  }

  /** 签发 Refresh Token（7d）——存 httpOnly Cookie，支持轮换；载荷含 domain/tenantId/role 供刷新时恢复身份 */
  issueRefreshToken(payload: AuthPayload, expiresInSeconds?: number): string {
    return this.jwt.sign(
      {
        sub: payload.sub,
        type: 'refresh',
        domain: payload.domain,
        tenantId: payload.tenantId,
        role: payload.role,
        roleId: payload.roleId,
        windows: payload.windows,
        sessionVersion: payload.sessionVersion,
        mustChangePassword: payload.mustChangePassword,
        sessionTimeoutMinutes: payload.sessionTimeoutMinutes,
        permissions: payload.permissions,
        name: payload.name,
        roleName: payload.roleName,
      },
      { expiresIn: expiresInSeconds ?? '7d' },
    );
  }

  issueActivationToken(tenantId: string, email: string): string {
    return this.jwt.sign(
      { type: 'tenant_activation', tenantId, email },
      { expiresIn: '24h' },
    );
  }

  readActivationToken(token: string): { tenantId: string; email: string } {
    try {
      const payload = this.jwt.verify(token) as {
        type?: string;
        tenantId?: string;
        email?: string;
      };
      if (
        payload.type !== 'tenant_activation' ||
        !payload.tenantId ||
        !payload.email
      )
        throw new Error('invalid activation token');
      return { tenantId: payload.tenantId, email: payload.email };
    } catch {
      throw new UnauthorizedException({
        code: 40102,
        message: '激活链接无效或已过期',
        data: null,
      });
    }
  }

  /** 校验 Access Token，明确拒绝 refresh token 被当作访问令牌使用。 */
  verifyAccessToken(token: string): AuthPayload {
    try {
      const payload = this.jwt.verify(token) as AuthPayload & { type?: string };
      if (
        payload.type ||
        !payload.sub ||
        !['platform', 'tenant'].includes(payload.domain) ||
        !payload.role
      )
        throw new Error('invalid access token');
      return payload;
    } catch {
      throw new UnauthorizedException({
        code: 40102,
        message: '访问令牌无效或已过期',
        data: null,
      });
    }
  }

  /** TOTP 校验（RFC 6238）——FR-019 MFA */
  verifyTotp(secretBase32: string, code: string, window = 1): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const epoch = Math.floor(Date.now() / 1000);
    try {
      for (let i = -window; i <= window; i++) {
        const counter = Math.floor(epoch / 30) + i;
        const expected = this.generateTotp(secretBase32, counter);
        if (this.safeEqual(expected, code)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 生成 TOTP（HMAC-SHA1，动态截断） */
  generateTotp(secretBase32: string, counter: number): string {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', this.decodeBase32(secretBase32))
      .update(buf)
      .digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return (code % 1_000_000).toString().padStart(6, '0');
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }

  private decodeBase32(value: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = value.toUpperCase().replace(/[\s=]/g, '');
    if (!clean || [...clean].some((c) => !alphabet.includes(c)))
      throw new Error('invalid base32 secret');
    let bits = 0,
      bitCount = 0;
    const bytes: number[] = [];
    for (const char of clean) {
      bits = (bits << 5) | alphabet.indexOf(char);
      bitCount += 5;
      if (bitCount >= 8) {
        bitCount -= 8;
        bytes.push((bits >> bitCount) & 0xff);
        bits &= (1 << bitCount) - 1;
      }
    }
    return Buffer.from(bytes);
  }

  /** 仅验证 refresh JWT 的签名与基本载荷；账号是否仍有效由调用方按存储层确认。 */
  readRefreshToken(token: string): AuthPayload {
    try {
      const payload = this.jwt.verify(token) as {
        sub?: string;
        type?: string;
        domain?: string;
        tenantId?: string;
        role?: string;
      };
      if (
        payload.type !== 'refresh' ||
        !payload.sub ||
        (payload.domain !== 'platform' && payload.domain !== 'tenant') ||
        !payload.role
      ) {
        throw new UnauthorizedException('40102: refresh 无效');
      }
      if (payload.domain === 'tenant' && !payload.tenantId)
        throw new UnauthorizedException('40102: refresh 无效');
      return payload as AuthPayload;
    } catch {
      throw new UnauthorizedException('40102: refresh_expired');
    }
  }

  /** 对已由账号存储层确认有效的载荷轮换令牌。 */
  rotateVerifiedPayload(payload: AuthPayload): {
    accessToken: string;
    refreshToken: string;
    payload: AuthPayload;
  } {
    const sessionSeconds = payload.sessionTimeoutMinutes
      ? payload.sessionTimeoutMinutes * 60
      : undefined;
    return {
      accessToken: this.issueAccessToken(
        payload,
        sessionSeconds ? Math.min(30 * 60, sessionSeconds) : undefined,
      ),
      refreshToken: this.issueRefreshToken(payload, sessionSeconds),
      payload,
    };
  }
}
