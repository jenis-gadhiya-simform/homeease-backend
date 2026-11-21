import { reconnectStrategy } from './redis.module.js';

describe('Redis reconnectStrategy', () => {
  const cause = new Error('ECONNREFUSED');

  it('retries with growing backoff during startup', () => {
    expect(reconnectStrategy(1, cause, false)).toBe(200);
    expect(reconnectStrategy(4, cause, false)).toBe(800);
  });

  it('gives up at startup after 5 attempts so boot fails instead of hanging', () => {
    const result = reconnectStrategy(5, cause, false);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Redis unreachable');
  });

  it('keeps reconnecting forever once it has connected, capped at 5s', () => {
    expect(reconnectStrategy(5, cause, true)).toBe(1_000);
    expect(reconnectStrategy(1_000, cause, true)).toBe(5_000);
  });
});
