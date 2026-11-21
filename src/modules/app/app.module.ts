import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ObserveModule } from '../../config/observe.js';
import { SharedMailModule } from '../../shared/mail/mail.module.js';
import { SharedQueueModule } from '../../shared/queue/queue.module.js';
import { SharedRedisModule } from '../../shared/redis/redis.module.js';
import { EmailModule } from '../email/email.module.js';
import { HealthModule } from '../health/health.module.js';
import { LoggingModule } from '../logger/logger.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { env, isProduction } from '../../config/env.js';

@Module({
  imports: [
    ObserveModule.forRoot({
      enabled: isProduction,
      // Never fake keys: they would be sent and refused.
      appKey: env.OBSERVE_APP_KEY ?? '',
      appSecret: env.OBSERVE_APP_SECRET ?? '',
      serviceId: 'backend',
      // Keep probe traffic out of traces.
      http: { ignore: ['/health', '/ready'] },
    }),
    LoggingModule,
    SharedRedisModule,
    // After ObserveModule, so jobs still running at shutdown are reported.
    SharedQueueModule,
    SharedMailModule,
    HealthModule,
    RateLimitModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
