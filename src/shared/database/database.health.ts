import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from './prisma.service.js';

/** Readiness check: PostgreSQL answers `SELECT 1` within the timeout. */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  isHealthy<const TKey extends string>(key: TKey) {
    // attempt() copies its result into the response body, so return nothing.
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      })
      .withTimeout('1s');
  }
}
