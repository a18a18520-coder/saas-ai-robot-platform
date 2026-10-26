import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/** JwtService 最小 mock（NestJS JwtService: sign/verify） */
const jwtMock = {
  sign: jest.fn((_payload: unknown, _options?: unknown) => 'signed-token'),
  verify: jest.fn((_token: string) => ({})),
};

describe('AuthService — 无感刷新轮换（API-002）', () => {
  const svc = new AuthService(jwtMock as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('issueRefreshToken', () => {
    it('载荷包含 domain/tenantId/role（供刷新时恢复身份）', () => {
      svc.issueRefreshToken({
        sub: 'platform-admin',
        domain: 'platform',
        role: 'SUPER_ADMIN',
        permissions: ['dashboard'],
      });
      const [, options] = jwtMock.sign.mock.calls[0];
      expect(jwtMock.sign.mock.calls[0][0]).toMatchObject({
        sub: 'platform-admin',
        type: 'refresh',
        domain: 'platform',
        role: 'SUPER_ADMIN',
        permissions: ['dashboard'],
      });
      expect((options as { expiresIn: string }).expiresIn).toBe('7d');
    });

    it('租户刷新凭据携带会话版本与首次改密状态', () => {
      svc.issueRefreshToken({
        sub: 'tenant-admin',
        domain: 'tenant',
        tenantId: 'tenant-1',
        role: 'TENANT_ADMIN',
        sessionVersion: 3,
        mustChangePassword: true,
      });
      expect(jwtMock.sign.mock.calls[0][0]).toMatchObject({
        sub: 'tenant-admin',
        type: 'refresh',
        sessionVersion: 3,
        mustChangePassword: true,
      });
    });
  });

  describe('tenant activation token', () => {
    it('签发 24 小时激活令牌并校验类型', () => {
      svc.issueActivationToken('t1', 'admin@example.com');
      expect(jwtMock.sign).toHaveBeenCalledWith(
        {
          type: 'tenant_activation',
          tenantId: 't1',
          email: 'admin@example.com',
        },
        { expiresIn: '24h' },
      );
      jwtMock.verify.mockReturnValue({
        type: 'tenant_activation',
        tenantId: 't1',
        email: 'admin@example.com',
      });
      expect(svc.readActivationToken('token')).toEqual({
        tenantId: 't1',
        email: 'admin@example.com',
      });
      jwtMock.verify.mockReturnValue({ type: 'access', tenantId: 't1' });
      expect(() => svc.readActivationToken('token')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('接受合法 access token，拒绝 refresh token', () => {
      jwtMock.verify.mockReturnValue({
        sub: 'a1',
        domain: 'tenant',
        tenantId: 't1',
        role: 'TENANT_OP',
        windows: ['users'],
      });
      expect(svc.verifyAccessToken('token')).toMatchObject({
        sub: 'a1',
        tenantId: 't1',
      });
      jwtMock.verify.mockReturnValue({
        sub: 'a1',
        type: 'refresh',
        domain: 'tenant',
        tenantId: 't1',
        role: 'TENANT_OP',
      });
      expect(() => svc.verifyAccessToken('token')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('TOTP', () => {
    it('按 RFC 6238 使用 Base32 密钥生成 6 位验证码', () => {
      expect(svc.generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe(
        '287082',
      );
      expect(svc.verifyTotp('invalid-*', '123456')).toBe(false);
    });
  });

  describe('readRefreshToken', () => {
    it('租户载荷缺 tenantId → 40102', () => {
      jwtMock.verify.mockReturnValue({
        sub: 'tenant-admin',
        type: 'refresh',
        domain: 'tenant',
        role: 'TENANT_ADMIN',
      });
      expect(() => svc.readRefreshToken('token')).toThrow('40102');
    });

    it('type 非 refresh → 40102', () => {
      jwtMock.verify.mockReturnValue({
        sub: 'platform-admin',
        type: 'access',
        domain: 'platform',
      });
      expect(() => svc.readRefreshToken('token')).toThrow('40102');
    });

    it('verify 抛错（过期/篡改）→ 40102', () => {
      jwtMock.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      expect(() => svc.readRefreshToken('bad-token')).toThrow('40102');
    });

    it('未知 domain → 40102', () => {
      jwtMock.verify.mockReturnValue({
        sub: 'x',
        type: 'refresh',
        domain: 'unknown',
      });
      expect(() => svc.readRefreshToken('token')).toThrow('40102');
    });
  });
});
