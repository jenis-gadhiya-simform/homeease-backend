import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { requestContextMiddleware } from '../shared/context/request-context.middleware.js';
import { env } from './env.js';

/**
 * HTTP-level setup shared by main.ts and the e2e tests, so tests run against
 * the same middleware as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // First middleware: request id + RequestContext (AsyncLocalStorage) for the
  // rest of the request, and X-Request-Id on every response.
  app.use(requestContextMiddleware);

  // Security headers (CSP, HSTS, X-Content-Type-Options, …); also removes X-Powered-By.
  app.use(helmet());

  // Validates every @Body/@Param/@Query that declares a { schema } (Zod); 400 on failure.
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  // Behind a load balancer / reverse proxy, trust its X-Forwarded-For so the
  // rate limiter sees the real client IP. Set TRUST_PROXY to the hop count.
  if (env.TRUST_PROXY !== undefined) {
    app.set('trust proxy', env.TRUST_PROXY);
  }
}
