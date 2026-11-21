import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * HTTP-level setup shared by main.ts and the e2e tests, so tests run against
 * the same middleware as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Security headers (CSP, HSTS, X-Content-Type-Options, …); also removes X-Powered-By.
  app.use(helmet());

  // Validates every @Body/@Param/@Query that declares a { schema } (Zod); 400 on failure.
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  // Behind a load balancer / reverse proxy, trust its X-Forwarded-For so the
  // rate limiter sees the real client IP. Set TRUST_PROXY to the hop count.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY));
  }
}
