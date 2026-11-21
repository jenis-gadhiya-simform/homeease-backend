import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { DefaultJobOptions } from 'bullmq';
import { env } from '../../config/env.js';

/**
 * Defaults for every job. BullMQ's own defaults are 1 attempt (no retry) and
 * keeping every finished job in Redis forever, which suits neither calls to
 * other services nor Redis memory.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 }, // 1s, 2s, 4s
  removeOnComplete: { age: 24 * 3600, count: 1_000 }, // keep 1 day / last 1000
  removeOnFail: { age: 7 * 24 * 3600 }, // keep failures 7 days for debugging
};

/**
 * Shared BullMQ setup: one Redis connection config and job defaults for every
 * queue in the app. Import once in AppModule (after ObserveModule, so jobs
 * still running at shutdown are reported).
 *
 * Feature modules then register and use their own queues:
 *
 *   imports: [BullModule.registerQueue({ name: 'emails' })]
 *   constructor(@InjectQueue('emails') private readonly emails: Queue) {}
 *   @Processor('emails') export class EmailsProcessor extends WorkerHost { … }
 */
@Module({
  imports: [
    // BullModule.forRoot is global: registerQueue() anywhere picks it up.
    BullModule.forRoot({
      // Same Redis as SharedRedisModule; BullMQ opens its own connections
      // (workers need blocking ones), and closes them on shutdown.
      connection: { url: env.REDIS_URL },
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  ],
})
export class SharedQueueModule {}
