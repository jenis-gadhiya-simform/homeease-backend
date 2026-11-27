import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AccountKind,
  RequestContext,
} from '../../shared/context/request-context.js';
import { type Subject, SubjectKind } from '../../shared/context/subject.js';
import type { Principal } from '../auth/auth.types.js';
import { TENANT_SCOPED, TenantResolver } from '../tenancy/tenant-resolver.js';

type SubjectRequest = Request & { user?: Principal; subject?: Subject | null };

/**
 * Builds the authorization subject (F03) after authentication: the
 * `user` the `@nestjs/authorization` guard hands to every policy.
 *
 * - `@TenantScoped()` routes: the caller's membership in the business the
 *   request acts in (`TenantResolver`, read from the database each request).
 * - Elsewhere: customer, platform admin, or a staff-side user outside any
 *   business.
 *
 * Stored in `RequestContext` (with the actor the audit log reads) and on the
 * request, so it is resolved once.
 */
@Injectable()
export class SubjectResolver {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantResolver,
  ) {}

  async resolve(context: ExecutionContext): Promise<Subject | null> {
    const req = context.switchToHttp().getRequest<SubjectRequest>();
    if (req.subject !== undefined) return req.subject;

    const tenantScoped = this.reflector.getAllAndOverride<boolean | undefined>(
      TENANT_SCOPED,
      [context.getHandler(), context.getClass()],
    );
    const subject = tenantScoped
      ? await this.tenants.resolve(req.user, req.headers)
      : subjectOf(req.user);

    req.subject = subject;
    if (subject && RequestContext.current()) {
      RequestContext.setSubject(subject);
      if (subject.kind === SubjectKind.STAFF) {
        RequestContext.setActor({
          kind: AccountKind.STAFF,
          userId: subject.userId,
          role: subject.role,
          tenantId: subject.tenantId,
        });
      }
    }
    return subject;
  }
}

/** The subject of a principal on a route outside any business. */
export function subjectOf(user: Principal | null | undefined): Subject | null {
  if (!user) return null;
  if (user.kind === AccountKind.CUSTOMER) {
    return { kind: SubjectKind.CUSTOMER, accountId: user.id };
  }
  return user.isPlatformAdmin
    ? { kind: SubjectKind.PLATFORM, userId: user.id }
    : { kind: SubjectKind.USER, userId: user.id };
}
