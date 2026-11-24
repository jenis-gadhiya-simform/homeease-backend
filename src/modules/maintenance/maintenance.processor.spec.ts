import { type Job, UnrecoverableError } from 'bullmq';
import { RequestContext } from '../../shared/context/request-context.js';
import type { UnverifiedAccountsCleanupService } from '../auth/unverified-accounts-cleanup.service.js';
import { MaintenanceJob } from './maintenance.constants.js';
import { MaintenanceProcessor } from './maintenance.processor.js';

describe('MaintenanceProcessor', () => {
  const result = {
    cutoff: '2026-11-17T10:00:00.000Z',
    deleted: 3,
    batches: 1,
    truncated: false,
  };

  function setup() {
    const purge = vi.fn(() => {
      // Runs inside a context opened for the job.
      expect(RequestContext.requestId()).toBe('job-42');
      return Promise.resolve(result);
    });
    const processor = new MaintenanceProcessor({
      purge,
    } as unknown as UnverifiedAccountsCleanupService);
    return { processor, purge };
  }

  const job = (name: string) =>
    ({ id: '42', name, attemptsMade: 0, data: {} }) as unknown as Job;

  it('runs the purge and returns its result (stored on the job)', async () => {
    const { processor, purge } = setup();

    await expect(
      processor.process(job(MaintenanceJob.PURGE_UNVERIFIED_CUSTOMERS)),
    ).resolves.toEqual(result);
    expect(purge).toHaveBeenCalledOnce();
  });

  it('fails an unknown job without retries', async () => {
    const { processor } = setup();

    await expect(processor.process(job('mystery'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
