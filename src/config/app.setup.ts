import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { requestContextMiddleware } from '../shared/context/request-context.middleware.js';
import { env } from './env.js';

/** CORS for the web app (APP_URL) only. */
function corsOptions() {
  return {
    // An allow-list (never `*`: credentials need an explicit origin). Only a
    // matching Origin gets the headers back, with `Vary: Origin` for caches.
    origin: [new URL(env.APP_URL).origin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Tenant-Id',
      'X-Request-Id',
    ],
    // Readable by the web app's scripts, e.g. to show the id with an error.
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    // Browsers cache the preflight answer this long (seconds).
    maxAge: 600,
  };
}

/**
 * HTTP-level setup shared by main.ts and the e2e tests, so tests run against
 * the same middleware as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // First middleware: request id + RequestContext (AsyncLocalStorage) for the
  // rest of the request, and X-Request-Id on every response.
  app.use(requestContextMiddleware);

  // The web app (APP_URL) is another origin (another port in dev, another
  // subdomain in production): let it call the API with credentials, so the
  // httpOnly `sw_refresh` cookie reaches /auth/refresh. No other origin gets
  // CORS headers, so browsers block every other site's pages from reading
  // responses. Preflights are answered here, before guards run.
  app.enableCors(corsOptions());

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
