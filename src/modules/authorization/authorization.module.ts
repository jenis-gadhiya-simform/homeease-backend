import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import {
  AuthorizationEvents,
  AuthorizationModule,
} from '@nestjs/authorization';
import type { Subject } from '../../shared/context/subject.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuthorizationCoverageCheck } from './authorization-coverage.js';
import { RolesPolicy } from './roles.policy.js';
import { SubjectResolver } from './subject.resolver.js';

/** Provides the subject resolver to `AuthorizationModule.forRootAsync()`. */
@Module({
  imports: [TenancyModule],
  providers: [SubjectResolver],
  exports: [SubjectResolver],
})
export class SubjectModule {}

/** Logs every denial with the policy and ability that refused it. */
@Injectable()
export class AuthorizationDenialLog implements OnModuleInit {
  private readonly logger = new Logger('Authorization');

  constructor(private readonly events: AuthorizationEvents) {}

  onModuleInit() {
    this.events.events$.subscribe((event) => {
      if (event.type !== 'denied') return;
      const subject = event.user as Subject | null;
      this.logger.warn({
        msg: 'Denied',
        handler: event.handler,
        policy: event.policy,
        ability: event.ability,
        reason: event.reason,
        subject: subject && {
          kind: subject.kind,
          ...('role' in subject && { role: subject.role }),
        },
      });
    });
  }
}

/**
 * Authorization (F03) with `@nestjs/authorization`: its global guard runs
 * every route's `@Roles()` (RBAC) or `@UsePolicy()` (ABAC) check against the
 * subject `SubjectResolver` builds, and denies routes that declare nothing.
 * `AuthorizationCoverageCheck` refuses to start when a route declares no
 * check or two.
 *
 * Import after AuthModule and RateLimitModule: authentication sets the user
 * first, the throttler runs before the membership read.
 */
@Module({
  imports: [
    DiscoveryModule,
    AuthorizationModule.forRootAsync({
      imports: [SubjectModule],
      inject: [SubjectResolver],
      useFactory: (subjects: SubjectResolver) => ({
        getUser: (context) => subjects.resolve(context),
      }),
    }),
  ],
  providers: [RolesPolicy, AuthorizationCoverageCheck, AuthorizationDenialLog],
})
export class AuthzModule {}
