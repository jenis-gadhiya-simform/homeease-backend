import { parseEnv } from './env.js';

const PROD_SECRET = 'x'.repeat(32);

describe('parseEnv', () => {
  it('applies defaults for an empty environment', () => {
    expect(parseEnv({})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      REDIS_URL: 'redis://localhost:6379',
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
      SHUTDOWN_GRACE_MS: 2_000,
      QUEUE_PREFIX: 'bull',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://localhost:1025',
    });
  });

  it('coerces numbers and booleans from strings', () => {
    const env = parseEnv({
      PORT: '8080',
      THROTTLE_LIMIT: '5',
      TRUST_PROXY: '1',
      SWAGGER_ENABLED: 'false',
    });
    expect(env).toMatchObject({
      PORT: 8080,
      THROTTLE_LIMIT: 5,
      TRUST_PROXY: 1,
      SWAGGER_ENABLED: false,
    });
  });

  it('treats empty values (KEY= in .env) as unset', () => {
    const env = parseEnv({
      LOG_LEVEL: '',
      TRUST_PROXY: '',
      OBSERVE_APP_KEY: '',
    });
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(env.TRUST_PROXY).toBeUndefined();
    expect(env.OBSERVE_APP_KEY).toBeUndefined();
  });

  it('accepts rediss:// and smtps:// URLs', () => {
    const env = parseEnv({
      REDIS_URL: 'rediss://:secret@cache.example.com:6380',
      SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
    });
    expect(env.REDIS_URL).toBe('rediss://:secret@cache.example.com:6380');
    expect(env.SMTP_URL).toBe('smtps://user:pass@smtp.example.com:465');
  });

  it('reports every invalid variable at once', () => {
    let message = '';
    try {
      parseEnv({
        PORT: 'abc',
        THROTTLE_LIMIT: '0',
        REDIS_URL: 'http://localhost:6379',
        MAIL_TRANSPORT: 'carrier-pigeon',
        SWAGGER_ENABLED: 'maybe',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Invalid environment variables');
    for (const key of [
      'PORT',
      'THROTTLE_LIMIT',
      'REDIS_URL',
      'MAIL_TRANSPORT',
      'SWAGGER_ENABLED',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('ignores unrelated variables', () => {
    expect(parseEnv({ PATH: '/usr/bin', HOME: '/home/x' })).not.toHaveProperty(
      'PATH',
    );
  });

  it('defaults DATABASE_URL to the docker Postgres outside production', () => {
    expect(parseEnv({}).DATABASE_URL).toBe(
      'postgresql://postgres:postgres@localhost:5433/slotwise-dev',
    );
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL[\s\S]*Required in production|Required in production[\s\S]*DATABASE_URL/,
    );
    expect(
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:secret@db.internal:5432/slotwise',
        JWT_SECRET: PROD_SECRET,
      }).DATABASE_URL,
    ).toBe('postgresql://app:secret@db.internal:5432/slotwise');
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires a JWT_SECRET of 32+ bytes in production, defaults it elsewhere', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:secret@db.internal:5432/slotwise',
    };
    expect(() => parseEnv(production)).toThrow(
      /Required in production[\s\S]*JWT_SECRET/,
    );
    expect(() => parseEnv({ ...production, JWT_SECRET: 'short' })).toThrow(
      /32 bytes[\s\S]*JWT_SECRET/,
    );
    expect(
      parseEnv({ ...production, JWT_SECRET: PROD_SECRET }).JWT_SECRET,
    ).toBe(PROD_SECRET);
    expect(Buffer.byteLength(parseEnv({}).JWT_SECRET)).toBeGreaterThanOrEqual(
      32,
    );
  });

  it('validates token lifetimes and APP_URL', () => {
    expect(parseEnv({}).ACCESS_TOKEN_TTL).toBe('15m');
    expect(() => parseEnv({ ACCESS_TOKEN_TTL: '15 minutes' })).toThrow(
      /ACCESS_TOKEN_TTL/,
    );
    expect(() => parseEnv({ APP_URL: 'ftp://x' })).toThrow(/APP_URL/);
  });
});
