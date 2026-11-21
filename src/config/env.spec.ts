import { parseEnv } from './env.js';

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
});
