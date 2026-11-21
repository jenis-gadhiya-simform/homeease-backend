import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { RedisModule as NestRedisModule } from '@nestjs-redis/client';
import { TerminusModule } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health.js';
import { env } from '../../config/env.js';

const REDIS_URL = env.REDIS_URL;
const STARTUP_CONNECT_ATTEMPTS = 5;

// Set once the first connection succeeds (see SharedRedisModule.onModuleInit).
let connectedOnce = false;

/**
 * Before the first connection: give up after a few attempts so startup fails
 * loudly instead of hanging. After it: keep reconnecting with backoff forever.
 */
export function reconnectStrategy(
  retries: number,
  cause: Error,
  hasConnected = connectedOnce,
): number | Error {
  if (!hasConnected && retries >= STARTUP_CONNECT_ATTEMPTS) {
    return new Error(
      `Redis unreachable at ${REDIS_URL} after ${retries} attempts: ${cause.message}`,
    );
  }
  return Math.min(retries * 200, 5_000);
}

const redisConnection = NestRedisModule.forRoot({
  options: {
    url: REDIS_URL,
    // Fail commands immediately while disconnected instead of queueing
    // them, so a Redis outage can't stall requests.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries, cause) => reconnectStrategy(retries, cause),
    },
  },
});

/**
 * Shared Redis connection for the whole app (rate limiting, caching, …).
 *
 * Global: inject the client anywhere with `@InjectRedis()` from
 * `@nestjs-redis/client`, or `RedisToken()` in a factory's `inject`.
 * The connection opens at startup and closes on shutdown.
 */
@Global()
@Module({
  // A dynamic module is exported by the same object it was imported with.
  imports: [redisConnection, TerminusModule],
  providers: [RedisHealthIndicator],
  exports: [redisConnection, RedisHealthIndicator],
})
export class SharedRedisModule implements OnModuleInit {
  // Runs after the client provider has connected.
  onModuleInit() {
    connectedOnce = true;
  }
}
