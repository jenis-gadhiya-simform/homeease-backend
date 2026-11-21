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

@Module({
  imports: [
    ObserveModule.forRoot({
      enabled: process.env.NODE_ENV === 'production',
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
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
