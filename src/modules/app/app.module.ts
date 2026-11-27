import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ObserveModule } from '../../config/observe.js';
import { ApiExceptionFilter } from '../../shared/errors/api-exception.filter.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { SharedMailModule } from '../../shared/mail/mail.module.js';
import { SharedQueueModule } from '../../shared/queue/queue.module.js';
import { SharedRedisModule } from '../../shared/redis/redis.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthzModule } from '../authorization/authorization.module.js';
import { EmailModule } from '../email/email.module.js';
import { HealthModule } from '../health/health.module.js';
import { LoggingModule } from '../logger/logger.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { TeamModule } from '../team/team.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
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
    DatabaseModule,
    SharedRedisModule,
    // After ObserveModule, so jobs still running at shutdown are reported.
    SharedQueueModule,
    SharedMailModule,
    HealthModule,
    // Before RateLimitModule: authentication runs first, then the throttler.
    AuthModule,
    RateLimitModule,
    // After both: @Roles() / @UsePolicy() checks run on the authenticated,
    // throttled request (F03).
    AuthzModule,
    EmailModule,
    AuditModule,
    TenancyModule,
    TeamModule,
    MaintenanceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Every error response is { error: { code, message, requestId } }.
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
