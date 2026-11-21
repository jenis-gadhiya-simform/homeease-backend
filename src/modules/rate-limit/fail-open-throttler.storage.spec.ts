import { Logger } from '@nestjs/common';
import { FailOpenThrottlerStorage } from './fail-open-throttler.storage.js';

describe('FailOpenThrottlerStorage', () => {
  const record = {
    totalHits: 4,
    timeToExpire: 30,
    isBlocked: true,
    timeToBlockExpire: 30,
  };

  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the inner storage result through', async () => {
    const increment = vi.fn().mockResolvedValue(record);
    const storage = new FailOpenThrottlerStorage({ increment });

    await expect(
      storage.increment('key', 60_000, 3, 0, 'default'),
    ).resolves.toBe(record);
    expect(increment).toHaveBeenCalledWith('key', 60_000, 3, 0, 'default');
  });

  it('allows the request and logs when the inner storage fails', async () => {
    const increment = vi
      .fn()
      .mockRejectedValue(new Error('The client is offline'));
    const storage = new FailOpenThrottlerStorage({ increment });

    await expect(
      storage.increment('key', 60_000, 3, 0, 'default'),
    ).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(logError).toHaveBeenCalledOnce();
  });
});
