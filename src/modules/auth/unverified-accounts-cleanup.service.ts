import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows per DELETE: small enough for short locks, large enough to be quick. */
export const PURGE_BATCH_SIZE = 500;
/** Upper bound per run (50,000 rows); anything left is picked up the next night. */
export const PURGE_MAX_BATCHES = 100;

export interface PurgeResult {
  /** Accounts created before this instant were eligible (UTC ISO string). */
  cutoff: string;
  deleted: number;
  batches: number;
  /** `true` when the run stopped at PURGE_MAX_BATCHES with work left. */
  truncated: boolean;
}

/**
 * Deletes abandoned customer accounts (F15): requesting a magic link
 * creates an account for any email, and one whose link is never opened
 * stays behind, unverified and unusable. After
 * `UNVERIFIED_ACCOUNT_RETENTION_DAYS` it is removed. See `abandonedSince()`
 * for exactly which accounts qualify; anyone who verified, set a password or
 * linked Google / Microsoft is never touched.
 *
 * Idempotent: running it twice, or concurrently, deletes each account once
 * (the DELETE re-checks the conditions), so BullMQ retries are safe.
 */
@Injectable()
export class UnverifiedAccountsCleanupService {
  private readonly logger = new Logger(UnverifiedAccountsCleanupService.name);

  constructor(private readonly accounts: CustomerAccountsRepository) {}

  async purge(
    now: Date = new Date(),
    retentionDays: number = env.UNVERIFIED_ACCOUNT_RETENTION_DAYS,
  ): Promise<PurgeResult> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let deleted = 0;
    let batches = 0;
    let truncated = false;

    while (true) {
      if (batches === PURGE_MAX_BATCHES) {
        truncated = true;
        break;
      }
      const ids = await this.accounts.findAbandonedIds(
        cutoff,
        PURGE_BATCH_SIZE,
      );
      if (ids.length === 0) break;
      deleted += await this.accounts.deleteAbandoned(ids, cutoff);
      batches += 1;
      if (ids.length < PURGE_BATCH_SIZE) break;
    }

    const result = {
      cutoff: cutoff.toISOString(),
      deleted,
      batches,
      truncated,
    };
    this.logger.log(result, 'Purged abandoned customer accounts');
    return result;
  }
}
