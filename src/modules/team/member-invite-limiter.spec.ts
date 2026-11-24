import { Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { MemberInviteLimiter } from './member-invite-limiter.js';

describe('MemberInviteLimiter', () => {
  const counts = new Map<string, number>();
  const redis = {
    incr: vi.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
    pExpire: vi.fn(async () => true),
  };
  const limiter = new MemberInviteLimiter(redis as unknown as RedisClientType);

  beforeEach(() => {
    counts.clear();
    vi.clearAllMocks();
  });

  it('allows MEMBER_INVITE_LIMIT (20) invitations per business per hour, then 429', async () => {
    for (let i = 0; i < 20; i++) await limiter.hit('tenant-a');
    await expect(limiter.hit('tenant-a')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(redis.pExpire).toHaveBeenCalledTimes(1);
    expect(redis.pExpire).toHaveBeenCalledWith(
      'member-invite:tenant-a',
      3_600_000,
    );
  });

  it('counts each business separately', async () => {
    for (let i = 0; i < 20; i++) await limiter.hit('tenant-a');
    await expect(limiter.hit('tenant-b')).resolves.toBeUndefined();
  });

  it('fails open when Redis is down', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(limiter.hit('tenant-a')).resolves.toBeUndefined();
  });
});
