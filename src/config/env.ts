import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();
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
});

const LOCAL_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/homeease-dev';

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
  })
  .transform((value) => ({
    ...value,
    DATABASE_URL: value.DATABASE_URL ?? LOCAL_DATABASE_URL,
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
