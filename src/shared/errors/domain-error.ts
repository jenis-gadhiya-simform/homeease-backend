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
