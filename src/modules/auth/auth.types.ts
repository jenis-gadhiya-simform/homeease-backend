/** A staff-side user (platform admin, Owner, Manager, Receptionist, Staff). */
export interface StaffPrincipal {
  kind: 'staff';
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

/** A customer account (self-service). */
export interface CustomerPrincipal {
  kind: 'customer';
  id: string;
  email: string;
  hasPassword: boolean;
  emailVerified: boolean;
}

/** Who the access token belongs to, loaded from the database on every request. */
export type Principal = StaffPrincipal | CustomerPrincipal;
export type PrincipalKind = Principal['kind'];

/**
 * Custom claims in our access tokens. Facts that can change (roles,
 * memberships) are never here: they're read from the database per request.
 */
export interface AccessTokenClaims {
  /** Which identity table `sub` belongs to. */
  kind: PrincipalKind;
  /** Platform admin (informational; authorization reads `User.isPlatformAdmin`). */
  pa: boolean;
  /** How the user signed in: `pwd` (password) or `email` (an emailed link). */
  amr: ('pwd' | 'email')[];
  /** Sign-in time, seconds since epoch; kept across refreshes. */
  auth_time: number;
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: Principal;
  }
}
