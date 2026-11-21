import { Test } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from '../../shared/database/database.health.js';
import { RedisHealthIndicator } from '../../shared/redis/redis.health.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  const health = { check: vi.fn() };
  const database = { isHealthy: vi.fn() };
  const redis = { isHealthy: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: DatabaseHealthIndicator, useValue: database },
        { provide: RedisHealthIndicator, useValue: redis },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('liveness answers ok without checking dependencies', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(health.check).not.toHaveBeenCalled();
    expect(database.isHealthy).not.toHaveBeenCalled();
    expect(redis.isHealthy).not.toHaveBeenCalled();
  });

  it('readiness runs the database and Redis checks', async () => {
    const result = { status: 'ok', info: { redis: { status: 'up' } } };
    health.check.mockImplementation(async (checks: Array<() => unknown>) => {
      await Promise.all(checks.map((check) => check()));
      return result;
    });

    await expect(controller.ready()).resolves.toBe(result);
    expect(database.isHealthy).toHaveBeenCalledWith('database');
    expect(redis.isHealthy).toHaveBeenCalledWith('redis');
  });
});
