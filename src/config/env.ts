import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();
/** A lifetime like `15m`, `12h`, `30d` (the format @nestjs/authentication takes). */
export type DurationString = `${number}${'s' | 'm' | 'h' | 'd'}`;
const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'A duration like 30s, 15m, 12h or 30d')
  .transform((value) => value as DurationString);
const sqlIdentifier = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,62}$/, 'A lowercase SQL identifier');
const urlWithProtocol = (...protocols: string[]) =>
  z.url({ protocol: new RegExp(`^(${protocols.join('|')})$`) });

/**
 * Every environment variable the app reads, validated once at startup.
 * Documented in docs/architecture.md (Configuration) and .env.example.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: port.default(3000),

  // Logging (pino)
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),

  // API docs
  SWAGGER_ENABLED: z.stringbool().optional(),

  // NestJS Observe
  OBSERVE_APP_KEY: z.string().optional(),
  OBSERVE_APP_SECRET: z.string().optional(),

  // HTTP
  TRUST_PROXY: nonNegativeInt.optional(),
  SHUTDOWN_GRACE_MS: nonNegativeInt.default(2_000),

  // Redis, rate limiting, queues
  REDIS_URL: urlWithProtocol('redis', 'rediss').default(
    'redis://localhost:6379',
  ),
  THROTTLE_TTL_MS: positiveInt.default(60_000),
  THROTTLE_LIMIT: positiveInt.default(100),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[\w-]+$/, 'letters, digits, _ and - only')
    .default('bull'),

  // Mail
  MAIL_TRANSPORT: z.enum(['smtp', 'log', 'file']).default('smtp'),
  SMTP_URL: urlWithProtocol('smtp', 'smtps').default('smtp://localhost:1025'),
  SMTP_STARTTLS: z.enum(['required', 'opportunistic', 'never']).optional(),
  MAIL_DIRECTORY: z.string().default('var/mail'),
  MAIL_FROM: z.string().min(3).default('Backend <no-reply@example.com>'),

  // PostgreSQL (Prisma). Local default = docker compose Postgres; required in production.
  DATABASE_URL: urlWithProtocol('postgresql', 'postgres').optional(),
  DATABASE_POOL_MAX: positiveInt.max(100).default(10),
  // Roles the app switches to on connect (F01 row-level security). The login
  // user in DATABASE_URL must be a member of both (the migration grants them
  // to the migrating user).
  DATABASE_APP_ROLE: sqlIdentifier.default('slotwise_app'),
  DATABASE_ADMIN_ROLE: sqlIdentifier.default('slotwise_admin'),

  // Authentication (F02). JWT_SECRET signs access tokens (HS256, 32+ bytes:
  // `openssl rand -base64 32`); required in production.
  JWT_SECRET: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value) >= 32,
      'Must be at least 32 bytes (openssl rand -base64 32)',
    )
    .optional(),
  ACCESS_TOKEN_TTL: duration.default('15m'),
  REFRESH_TOKEN_TTL: duration.default('30d'),
  // Max sign-in / magic-link / password-reset attempts per minute, per IP and per email.
  AUTH_THROTTLE_LIMIT: positiveInt.default(5),
  // Base URL of the web app; emailed links (account setup, magic link, reset) point here.
  APP_URL: urlWithProtocol('http', 'https').default('http://localhost:5173'),

  // Platform admin, read only by the seed (`npm run db:seed`). In production
  // they come from the secret manager for the deploy step, not the app.
  PLATFORM_ADMIN_EMAIL: z.email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().optional(),
  PLATFORM_ADMIN_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default('Platform Admin'),
});

const LOCAL_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/slotwise-dev';

/** Outside production only: a fixed, public secret so tokens survive restarts. */
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-do-not-use-in-production';

/** Cross-field rules and environment-dependent defaults. */
const appEnvSchema = envSchema
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Required in production',
      });
    }
    if (value.NODE_ENV === 'production' && !value.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Required in production',
      });
    }
  })
  .transform((value) => ({
    ...value,
    DATABASE_URL: value.DATABASE_URL ?? LOCAL_DATABASE_URL,
    JWT_SECRET: value.JWT_SECRET ?? DEV_JWT_SECRET,
  }));

export type Env = z.output<typeof appEnvSchema>;

/**
 * Parses an environment. Empty values (`LOG_LEVEL=` in .env) count as unset.
 * Throws one error listing every invalid variable.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const defined = Object.fromEntries(
    Object.entries(source).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  );
  const result = appEnvSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * The validated environment. Read config from here, never from process.env:
 * values are typed, defaulted and checked when the app starts.
 */
export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
