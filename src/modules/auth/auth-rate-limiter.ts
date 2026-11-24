import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-redis/client';
import type { RedisClientType } from 'redis';
import { env } from '../../config/env.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';

const WINDOW_MS = 60_000;

/**
 * Per-email limit for sign-in, magic-link and password-reset requests
 * (AUTH_THROTTLE_LIMIT per minute), counted in Redis so every instance
 * shares it. The per-IP limit is `@Throttle()` on the routes.
 *
 * Fails open like the global throttler: a Redis outage must not lock
 * everyone out.
 */
@Injectable()
export class AuthRateLimiter {
  private readonly logger = new Logger(AuthRateLimiter.name);

  constructor(@InjectRedis() private readonly redis: RedisClientType) {}

  /** Counts one attempt; throws 429 once the email is over the limit. */
  async hit(action: string, email: string): Promise<void> {
    // Hash the address: keys show up in Redis tooling and memory dumps.
    const digest = createHash('sha256').update(email).digest('hex');
    const key = `auth-throttle:${action}:${digest}`;
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.pExpire(key, WINDOW_MS);
    } catch (error) {
      this.logger.warn({ err: error }, 'Auth rate limiter unavailable');
      return;
    }
    if (count > env.AUTH_THROTTLE_LIMIT) {
      throw new DomainError(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RateLimited,
        'Too many attempts for this email. Try again in a minute.',
      );
    }
  }
}
