import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisToken } from '@nestjs-redis/client';
import { RedisThrottlerStorage } from '@nestjs-redis/throttler-storage';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { RedisClientType } from 'redis';
import { FailOpenThrottlerStorage } from './fail-open-throttler.storage.js';
import { env } from '../../config/env.js';

/**
 * Global rate limit, counted in Redis so every instance shares the same budget.
 *
 * Defaults: 100 requests per minute per client IP, per route.
 * - `@SkipThrottle()` opts a controller/route out.
 * - `@Throttle({ default: { limit: 5, ttl: 60_000 } })` tightens one route.
 *
 * When authentication is added, import this module AFTER it and track by user:
 * `getTracker: (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`)`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisToken()],
      useFactory: (redis: RedisClientType) => ({
        throttlers: [
          {
            ttl: env.THROTTLE_TTL_MS,
            limit: env.THROTTLE_LIMIT,
          },
        ],
        storage: new FailOpenThrottlerStorage(new RedisThrottlerStorage(redis)),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
