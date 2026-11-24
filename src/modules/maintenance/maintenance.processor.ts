import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { RequestContext } from '../../shared/context/request-context.js';
import { UnverifiedAccountsCleanupService } from '../auth/unverified-accounts-cleanup.service.js';
import { MAINTENANCE_QUEUE, MaintenanceJob } from './maintenance.constants.js';

/**
 * The worker for the maintenance queue. BullMQ calls `process()` once per
 * job, scheduled or manual, on whichever instance takes it. Whatever it
 * returns is stored on the job (`returnvalue`); a throw makes BullMQ retry
 * with backoff (3 attempts), except `UnrecoverableError`, which fails at once.
 * Jobs can therefore run more than once: every job here must be idempotent.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly cleanup: UnverifiedAccountsCleanupService) {
    super();
  }

  async process(job: Job) {
    // Jobs have no HTTP request: open a context so logs and errors carry an id.
    return RequestContext.run(
      { requestId: `job-${job.id}`, ip: undefined, actor: undefined },
      async () => {
        this.logger.log(
          { jobId: job.id, job: job.name, attempt: job.attemptsMade + 1 },
          'Maintenance job started',
        );
        switch (job.name) {
          case MaintenanceJob.PURGE_UNVERIFIED_CUSTOMERS:
            return this.cleanup.purge();
          default:
            throw new UnrecoverableError(
              `Unknown maintenance job "${job.name}"`,
            );
        }
      },
    );
  }
}
