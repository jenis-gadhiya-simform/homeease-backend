import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-redis/client';
import type { RedisClientType } from 'redis';
import { env } from '../../config/env.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';

const WINDOW_MS = 60 * 60 * 1000;

/**
 * Caps the invitation emails one business can trigger (add member + resend
 * setup) at MEMBER_INVITE_LIMIT per hour, so the team API can't be used to
 * spam addresses (F04). Counted per tenant in Redis, shared by every
 * instance; `@Throttle()` can't do this because the tenant is resolved after
 * the global throttler runs.
 *
 * Fails open like the global throttler: a Redis outage must not block
 * onboarding a team.
 */
@Injectable()
export class MemberInviteLimiter {
  private readonly logger = new Logger(MemberInviteLimiter.name);

  constructor(@InjectRedis() private readonly redis: RedisClientType) {}

  /** Counts one invitation; throws 429 once the business is over the limit. */
  async hit(tenantId: string): Promise<void> {
    const key = `member-invite:${tenantId}`;
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.pExpire(key, WINDOW_MS);
    } catch (error) {
      this.logger.warn({ err: error }, 'Member invite limiter unavailable');
      return;
    }
    if (count > env.MEMBER_INVITE_LIMIT) {
      throw new DomainError(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RateLimited,
        'Too many invitations from this business. Try again later.',
      );
    }
  }
}
