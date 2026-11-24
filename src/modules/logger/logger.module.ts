import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import type { LoggerOptions } from 'pino';
import { env, isProduction } from '../../config/env.js';
import { resolveRequestId } from '../../shared/context/request-context.js';

/** Query parameters that are one-time secrets (OIDC callback, link intents, F02 v2). */
const SECRET_QUERY_PARAMS = ['code', 'state', 'intent', 'id_token'];

/** The request URL with secret query values replaced, so log lines can't replay a login. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let changed = false;
  for (const name of SECRET_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, '[REDACTED]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}

/**
 * Structured logging with pino (via nestjs-pino).
 *
 * - Production: one JSON line per log on stdout, shaped the way NestJS Observe
 *   parses it (`message` key, string `level`, `context`, `traceId`).
 * - Development: human-readable output through pino-pretty.
 */
export function buildLoggerParams(tracer: TracerService): Params {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    // Observe's log parser reads `message` and a string level ("info", "warn"…).
    messageKey: 'message',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: stdTimeFunctions.isoTime,
    // Correlate every line with the Observe trace it was written in.
    mixin: () => {
      const traceId = tracer.currentTraceId();
      return traceId ? { traceId } : {};
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.currentPassword',
        '*.newPassword',
      ],
      censor: '[REDACTED]',
    },
  };

  const httpOptions = {
    ...options,
    // Same id as RequestContext, the X-Request-Id header and error bodies.
    genReqId: (req: IncomingMessage) => resolveRequestId(req),
    customLogLevel: (
      _req: IncomingMessage,
      res: { statusCode: number },
      err?: Error,
    ) => {
      if (err || res.statusCode >= 500) return 'error' as const;
      if (res.statusCode >= 400) return 'warn' as const;
      return 'info' as const;
    },
    autoLogging: {
      // Skip probes and the Swagger UI (/docs and its assets).
      ignore: (req: IncomingMessage) =>
        req.url === '/health' ||
        req.url === '/ready' ||
        req.url === '/docs' ||
        !!req.url?.startsWith('/docs/') ||
        !!req.url?.startsWith('/docs-json'),
    },
    // Keep request lines short: no headers, body or socket details.
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: redactUrl(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  };

  if (!isProduction) {
    return {
      pinoHttp: {
        ...httpOptions,
        transport: {
          target: 'pino-pretty',
          options: {
            messageKey: 'message',
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      },
    };
  }

  // Write through process.stdout (not pino's default direct fd write) so
  // Observe's stdout forwarder sees each line inside its request context.
  return { pinoHttp: [httpOptions, process.stdout] };
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [TracerService],
      useFactory: buildLoggerParams,
    }),
  ],
})
export class LoggingModule {}
