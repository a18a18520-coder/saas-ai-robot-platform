import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { parseAllowedOrigins } from './environment';

const LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://[::1]:4173',
];

export function buildCorsOptions(env: NodeJS.ProcessEnv): CorsOptions {
  const configured = parseAllowedOrigins(env.CORS_ORIGINS);
  const allowed = new Set(configured.length ? configured : env.NODE_ENV === 'production' ? [] : LOCAL_ORIGINS);

  return {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    origin(origin, callback) {
      if (!origin || allowed.has(origin.replace(/\/$/, ''))) return callback(null, true);
      return callback(new Error('该来源不在 CORS 白名单中'), false);
    },
  };
}
