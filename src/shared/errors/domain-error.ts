import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes clients can branch on. Codes are part
 * of the API contract: add new ones, never rename or reuse one.
 */
export const ErrorCode = {
  // Generic, derived from the HTTP status when nothing more specific applies.
  ValidationFailed: 'VALIDATION_FAILED',
  BadRequest: 'BAD_REQUEST',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  RateLimited: 'RATE_LIMITED',
  InternalError: 'INTERNAL_ERROR',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  // Database constraints, when a service didn't map them to a domain code.
  AlreadyExists: 'ALREADY_EXISTS',
  // Domain codes. Features add theirs here (e.g. SLOT_TAKEN in F07).
  SlotTaken: 'SLOT_TAKEN',
  // F02 authentication
  /** Wrong email or password, or the account can't sign in (same answer for all). */
  InvalidCredentials: 'INVALID_CREDENTIALS',
  /** An emailed link (setup, reset, magic link) is unknown, used or expired: 410. */
  LinkExpired: 'LINK_EXPIRED',
  /** Changing a password needs the current one, or a fresh magic-link sign-in. */
  ReauthenticationRequired: 'REAUTHENTICATION_REQUIRED',
  /** A customer token on a staff endpoint, or the reverse. */
  WrongAccountType: 'WRONG_ACCOUNT_TYPE',
  // F02 v2 social sign-in (also sent as `?error=` on browser redirects)
  /** The provider login failed: bad state, expired login, provider error, invalid ID token, cancelled. */
  SocialSignInFailed: 'SOCIAL_SIGN_IN_FAILED',
  /** The provider didn't assert a verified email, so it can't create or join an account by email. */
  EmailNotVerified: 'EMAIL_NOT_VERIFIED',
  /** An account with this email exists but can't be joined automatically: sign in and link from the account. */
  AccountLinkRequired: 'ACCOUNT_LINK_REQUIRED',
  /** This Google / Microsoft account is already linked to another customer account. */
  IdentityInUse: 'IDENTITY_IN_USE',
  /** The account already has a different account of this provider linked: unlink it first. */
  ProviderAlreadyLinked: 'PROVIDER_ALREADY_LINKED',
  // F01 tenancy
  /** Another business already uses this slug. */
  SlugTaken: 'SLUG_TAKEN',
  /** The business is suspended: staff API 403 (public pages answer 404). */
  TenantSuspended: 'TENANT_SUSPENDED',
  /** The signed-in user has no active membership in the requested business. */
  NotAMember: 'NOT_A_MEMBER',
  /** The user belongs to several businesses: send `X-Tenant-Id`. */
  TenantRequired: 'TENANT_REQUIRED',
  /** A platform admin's email can't be a business Owner (422). */
  OwnerIsPlatformAdmin: 'OWNER_IS_PLATFORM_ADMIN',
  /** The owner email belongs to a disabled user (422). */
  OwnerDisabled: 'OWNER_DISABLED',
  /** The Owner already set a password: use ownership transfer (F03) instead (409). */
  OwnerAlreadyActive: 'OWNER_ALREADY_ACTIVE',
  // F04 team members & staff
  /** The email already has an active membership in this business (409). */
  AlreadyMember: 'ALREADY_MEMBER',
  /** Adding an OWNER, changing a role to/from OWNER or removing the Owner: use ownership transfer (F03) (422). */
  OwnershipTransferRequired: 'OWNERSHIP_TRANSFER_REQUIRED',
  /** A platform admin's email can't be added to a business (422). */
  MemberIsPlatformAdmin: 'MEMBER_IS_PLATFORM_ADMIN',
  /** The email belongs to a disabled user (422). */
  MemberDisabled: 'MEMBER_DISABLED',
  /** Resend-setup for a member who has already set a password (409). */
  MemberAlreadyActive: 'MEMBER_ALREADY_ACTIVE',
  /** A member with role STAFF always has an active calendar (422). */
  StaffMustBeBookable: 'STAFF_MUST_BE_BOOKABLE',
  // F03 authorization
  /** Members can only add, change or remove members of a lower role (rule A8) (403). */
  RoleRankTooLow: 'ROLE_RANK_TOO_LOW',
  /** Ownership can only go to another active Manager who has set up their account (422). */
  TransferTargetInvalid: 'TRANSFER_TARGET_INVALID',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * An expected business error with a stable `code`, answered as
 * `{ "error": { "code", "message", "requestId" } }` by `ApiExceptionFilter`.
 *
 * ```ts
 * throw new DomainError(HttpStatus.CONFLICT, ErrorCode.SlotTaken, 'That slot was just booked');
 * ```
 *
 * It is an `HttpException`, so anything that understands Nest exceptions
 * (Observe, tests, Swagger) still sees the right status.
 */
export class DomainError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, status, options);
    this.name = 'DomainError';
  }
}
