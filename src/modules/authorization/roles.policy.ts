import { Policy } from '@nestjs/authorization';
import type { MemberRole } from '../../generated/prisma/client.js';
import {
  PLATFORM_ADMIN_ROLE,
  RequestContext,
} from '../../shared/context/request-context.js';
import { type Subject, SubjectKind } from '../../shared/context/subject.js';

/** A role `@Roles()` accepts: a tenant role, or the platform admin. */
export type SubjectRole = MemberRole | typeof PLATFORM_ADMIN_ROLE;

/**
 * RBAC (F03): the subject's role alone decides. No resource is loaded and no
 * other attribute is read, so the same role always gets the same answer.
 * Used through `@Roles()`, not directly.
 */
@Policy()
export class RolesPolicy {
  hasRole(subject: Subject | null, roles: readonly SubjectRole[]): boolean {
    const role = roleOf(subject);
    return role !== null && roles.includes(role);
  }
}

export function roleOf(subject: Subject | null): SubjectRole | null {
  switch (subject?.kind) {
    case SubjectKind.STAFF:
      return subject.role;
    case SubjectKind.PLATFORM:
      return PLATFORM_ADMIN_ROLE;
    default:
      return null;
  }
}

/** The current subject's role, for services on `@Roles()` routes. */
export function currentRole(): SubjectRole | null {
  return roleOf(RequestContext.subject() ?? null);
}
