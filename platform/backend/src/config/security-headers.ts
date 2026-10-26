import { RequestHandler } from 'express';

/** API 安全响应头；不依赖前置代理也能保持一致的基线。 */
export function securityHeaders(production: boolean): RequestHandler {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (production)
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    if (req.path.startsWith('/api/v1/platform/auth/'))
      res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
