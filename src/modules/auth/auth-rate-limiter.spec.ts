import { Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { AuthRateLimiter } from './auth-rate-limiter.js';

describe('AuthRateLimiter', () => {
  const counts = new Map<string, number>();
  const redis = {
    incr: vi.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
    pExpire: vi.fn(async () => true),
  };
  const limiter = new AuthRateLimiter(redis as unknown as RedisClientType);

  beforeEach(() => {
    counts.clear();
    vi.clearAllMocks();
  });

  it('allows AUTH_THROTTLE_LIMIT (5) attempts per email, then 429', async () => {
    for (let i = 0; i < 5; i++) await limiter.hit('staff-login', 'a@x');
    await expect(limiter.hit('staff-login', 'a@x')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(redis.pExpire).toHaveBeenCalledTimes(1);
    expect(redis.pExpire).toHaveBeenCalledWith(expect.any(String), 60_000);
  });

  it('counts per action and per email, with the email hashed in the key', async () => {
    for (let i = 0; i < 5; i++) await limiter.hit('staff-login', 'a@x');
    await expect(limiter.hit('staff-login', 'b@x')).resolves.toBeUndefined();
    await expect(limiter.hit('magic-link', 'a@x')).resolves.toBeUndefined();
    for (const key of counts.keys()) expect(key).not.toContain('@');
  });

  it('fails open when Redis is down', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(limiter.hit('staff-login', 'a@x')).resolves.toBeUndefined();
  });
});
