import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DISPLAY_TIMEZONE } from '../../shared/time/time.js';
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  MAINTENANCE_SCHEDULES,
  type MaintenanceJob,
} from './maintenance.constants.js';

/**
 * Registers the maintenance schedules with BullMQ at startup.
 *
 * A **job scheduler** lives in Redis, not in this process: `upsertJobScheduler`
 * creates it or updates it in place (same id), so every instance can call it
 * on every start without duplicates. Redis then produces exactly one job per
 * tick, whichever instance (or none) is running, and any instance's worker
 * picks it up. That's why no lock is needed (F15 planned `@nestjs/locks`
 * around an in-process cron; see the F15 implementation summary).
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    for (const job of MAINTENANCE_JOBS) {
      await this.queue.upsertJobScheduler(
        job,
        { pattern: MAINTENANCE_SCHEDULES[job], tz: DISPLAY_TIMEZONE },
        // The template for each job the scheduler creates. Default job
        // options (3 attempts, backoff, retention) come from SharedQueueModule.
        { name: job, data: {} },
      );
    }
    this.logger.log(
      { jobs: MAINTENANCE_JOBS, timezone: DISPLAY_TIMEZONE },
      'Maintenance schedules registered',
    );
  }

  /** Every schedule with its next run (UTC), for the admin API. */
  async schedules() {
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => ({
      job: scheduler.name,
      pattern: scheduler.pattern ?? null,
      timezone: scheduler.tz ?? null,
      nextRunAt:
        scheduler.next === undefined
          ? null
          : new Date(scheduler.next).toISOString(),
    }));
  }

  /**
   * Runs a maintenance job now, outside its schedule. A one-off job on the
   * same queue: the same worker processes it. The id has no `:` (BullMQ
   * reserves it) and is unique per call.
   */
  async runNow(job: MaintenanceJob) {
    const created = await this.queue.add(
      job,
      {},
      { jobId: `${job}-manual-${Date.now()}` },
    );
    return { jobId: created.id };
  }

  /** A job's state and result, for following a manual run. */
  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      job: job.name,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      result: (job.returnvalue as unknown) ?? null,
      failedReason: job.failedReason ?? null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
    };
  }
}
