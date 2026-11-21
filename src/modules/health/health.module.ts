import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { env } from '../../config/env.js';

@Module({
  imports: [
    // On SIGTERM, /ready answers 503 for this long before Nest closes, so the
    // load balancer stops routing traffic to this instance first.
    TerminusModule.forRoot({
      gracefulShutdownTimeoutMs: env.SHUTDOWN_GRACE_MS,
    }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
