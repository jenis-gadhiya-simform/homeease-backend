import { Test } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { RedisHealthIndicator } from '../../shared/redis/redis.health.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  const health = { check: vi.fn() };
  const redis = { isHealthy: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: RedisHealthIndicator, useValue: redis },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('liveness answers ok without checking dependencies', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(health.check).not.toHaveBeenCalled();
    expect(redis.isHealthy).not.toHaveBeenCalled();
  });

  it('readiness runs the Redis check', async () => {
    const result = { status: 'ok', info: { redis: { status: 'up' } } };
    health.check.mockImplementation(async (checks: Array<() => unknown>) => {
      await Promise.all(checks.map((check) => check()));
      return result;
    });

    await expect(controller.ready()).resolves.toBe(result);
    expect(redis.isHealthy).toHaveBeenCalledWith('redis');
  });
});
