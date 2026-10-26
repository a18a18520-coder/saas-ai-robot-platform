import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildCorsOptions } from './config/cors';
import { RedactingLogger } from './common/logging/redacting-logger';
import { securityHeaders } from './config/security-headers';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: new RedactingLogger() });
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  app.use(securityHeaders(process.env.NODE_ENV === 'production'));
  app.enableCors(buildCorsOptions(process.env));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
