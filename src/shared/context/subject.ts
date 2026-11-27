import { MemberRole } from '../../generated/prisma/client.js';

/** What kind of caller a `Subject` is (F03). */
export const SubjectKind = {
  /** A member of the business the request acts in (`@TenantScoped()` routes). */
  STAFF: 'staff',
  /** A customer account. */
  CUSTOMER: 'customer',
  /** The platform admin. */
  PLATFORM: 'platform',
  /** A staff-side user on a route outside any business (e.g. an Owner calling `/admin/*`). */
  USER: 'user',
} as const;
export type SubjectKind = (typeof SubjectKind)[keyof typeof SubjectKind];

/** A member acting inside one business: role and calendar come from their membership. */
export interface StaffSubject {
  kind: typeof SubjectKind.STAFF;
  userId: string;
  tenantId: string;
  role: MemberRole;
  /** Their calendar in this business, if they have one (active or not). */
  staffId: string | null;
}

/** A customer. The same whichever way they signed in (F02): no policy reads the sign-in method. */
export interface CustomerSubject {
  kind: typeof SubjectKind.CUSTOMER;
  accountId: string;
}

export interface PlatformSubject {
  kind: typeof SubjectKind.PLATFORM;
  userId: string;
  /** Temporary access to one tenant's PII (F19). Not granted anywhere yet. */
  breakGlass?: { tenantId: string; expiresAt: Date };
}

/** A staff-side user with no business resolved for this route. */
export interface UserSubject {
  kind: typeof SubjectKind.USER;
  userId: string;
}

/**
 * Who is asking, as authorization sees it (F03). Built per request from the
 * authenticated principal and, on tenant routes, the membership read from
 * the database (never from the token).
 */
export type Subject =
  StaffSubject | CustomerSubject | PlatformSubject | UserSubject;

/** `OWNER 4 > MANAGER 3 > RECEPTIONIST 2 > STAFF 1` (rule A8). */
export const ROLE_RANK: Record<MemberRole, number> = {
  [MemberRole.OWNER]: 4,
  [MemberRole.MANAGER]: 3,
  [MemberRole.RECEPTIONIST]: 2,
  [MemberRole.STAFF]: 1,
};

export function isStaffSubject(
  subject: Subject | null | undefined,
): subject is StaffSubject {
  return subject?.kind === SubjectKind.STAFF;
}
