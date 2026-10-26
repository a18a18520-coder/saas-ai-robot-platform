import { securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('为登录响应设置安全头与禁止缓存', () => {
    const setHeader = jest.fn();
    const next = jest.fn();
    securityHeaders(true)(
      { path: '/api/v1/platform/auth/login' } as any,
      { setHeader } as any,
      next,
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.stringContaining('max-age='),
    );
    expect(setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('非生产环境不下发 HSTS', () => {
    const setHeader = jest.fn();
    securityHeaders(false)(
      { path: '/api/v1/public/health/live' } as any,
      { setHeader } as any,
      jest.fn(),
    );
    expect(setHeader).not.toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.anything(),
    );
  });
});
