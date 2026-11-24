import { AccountKind } from '../../shared/context/request-context.js';

/** A staff-side user (platform admin, Owner, Manager, Receptionist, Staff). */
export interface StaffPrincipal {
  kind: typeof AccountKind.STAFF;
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

/** A customer account (self-service). */
export interface CustomerPrincipal {
  kind: typeof AccountKind.CUSTOMER;
  id: string;
  email: string;
  hasPassword: boolean;
  emailVerified: boolean;
}

/** Who the access token belongs to, loaded from the database on every request. */
export type Principal = StaffPrincipal | CustomerPrincipal;
export type PrincipalKind = AccountKind;

/** How the user signed in (the token's `amr` claim). */
export const SignInMethod = {
  /** Password. */
  PASSWORD: 'pwd',
  /** An emailed link (magic link). */
  EMAIL_LINK: 'email',
  /** Google or Microsoft (OpenID Connect). */
  OIDC: 'oidc',
} as const;
export type SignInMethod = (typeof SignInMethod)[keyof typeof SignInMethod];

/**
 * Custom claims in our access tokens. Facts that can change (roles,
 * memberships) are never here: they're read from the database per request.
 */
export interface AccessTokenClaims {
  /** Which identity table `sub` belongs to. */
  kind: PrincipalKind;
  /** Platform admin (informational; authorization reads `User.isPlatformAdmin`). */
  pa: boolean;
  /** How the user signed in: `pwd` (password), `email` (an emailed link) or `oidc` (Google / Microsoft). */
  amr: SignInMethod[];
  /** Sign-in time, seconds since epoch; kept across refreshes. */
  auth_time: number;
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: Principal;
  }
}
