import type { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import {
  PURGE_BATCH_SIZE,
  PURGE_MAX_BATCHES,
  UnverifiedAccountsCleanupService,
} from './unverified-accounts-cleanup.service.js';

describe('UnverifiedAccountsCleanupService', () => {
  const now = new Date('2026-11-24T10:00:00.000Z');
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  function setup(batches: string[][]) {
    const findAbandonedIds =
      vi.fn<CustomerAccountsRepository['findAbandonedIds']>();
    for (const batch of batches) findAbandonedIds.mockResolvedValueOnce(batch);
    findAbandonedIds.mockResolvedValue([]);
    const deleteAbandoned = vi.fn<
      CustomerAccountsRepository['deleteAbandoned']
    >((batch) => Promise.resolve(batch.length));
    const repo = { findAbandonedIds, deleteAbandoned };
    const service = new UnverifiedAccountsCleanupService(
      repo as unknown as CustomerAccountsRepository,
    );
    return { service, findAbandonedIds, deleteAbandoned };
  }

  it('uses a cutoff of `now − retention days`', async () => {
    const { service, findAbandonedIds } = setup([]);

    const result = await service.purge(now, 7);

    expect(result).toEqual({
      cutoff: '2026-11-17T10:00:00.000Z',
      deleted: 0,
      batches: 0,
      truncated: false,
    });
    expect(findAbandonedIds).toHaveBeenCalledWith(
      new Date('2026-11-17T10:00:00.000Z'),
      PURGE_BATCH_SIZE,
    );
  });

  it('deletes in batches until a short batch', async () => {
    const { service, deleteAbandoned } = setup([
      ids(PURGE_BATCH_SIZE),
      ids(PURGE_BATCH_SIZE),
      ids(3),
    ]);

    const result = await service.purge(now, 7);

    expect(result.deleted).toBe(2 * PURGE_BATCH_SIZE + 3);
    expect(result.batches).toBe(3);
    expect(deleteAbandoned).toHaveBeenCalledTimes(3);
  });

  it('counts only rows the DELETE actually removed', async () => {
    const { service, deleteAbandoned } = setup([ids(4)]);
    // Two of the four were verified between the SELECT and the DELETE.
    deleteAbandoned.mockResolvedValueOnce(2);

    expect((await service.purge(now, 7)).deleted).toBe(2);
  });

  it('stops after PURGE_MAX_BATCHES and reports the run as truncated', async () => {
    const { service, findAbandonedIds } = setup(
      Array.from({ length: PURGE_MAX_BATCHES + 5 }, () =>
        ids(PURGE_BATCH_SIZE),
      ),
    );

    const result = await service.purge(now, 7);

    expect(result.batches).toBe(PURGE_MAX_BATCHES);
    expect(result.truncated).toBe(true);
    expect(findAbandonedIds).toHaveBeenCalledTimes(PURGE_MAX_BATCHES);
  });
});
