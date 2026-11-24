import { Controller, Get, UseFilters } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseHealthIndicator } from '../../shared/database/database.health.js';
import { RedisHealthIndicator } from '../../shared/redis/redis.health.js';
import { HealthCheckFilter } from './health-check.filter.js';

@ApiTags('Health')
@Public()
@SkipThrottle()
@UseFilters(HealthCheckFilter)
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: hard dependencies answer. 503 when any check fails or during shutdown. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (checks PostgreSQL and Redis)' })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is down, or the app is shutting down',
  })
  ready() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
