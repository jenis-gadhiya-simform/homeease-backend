import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-redis/client';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { RedisClientType } from 'redis';

/** Readiness check: Redis answers PING within the timeout. */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @InjectRedis() private readonly redis: RedisClientType,
  ) {}

  isHealthy<const TKey extends string>(key: TKey) {
    // attempt() copies its result into the response body, so return nothing.
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout('1s');
  }
}
