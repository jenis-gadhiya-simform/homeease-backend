import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    // On SIGTERM, /ready answers 503 for this long before Nest closes, so the
    // load balancer stops routing traffic to this instance first.
    TerminusModule.forRoot({
      gracefulShutdownTimeoutMs: Number(process.env.SHUTDOWN_GRACE_MS ?? 2_000),
    }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
