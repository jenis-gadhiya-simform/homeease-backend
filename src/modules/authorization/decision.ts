import { HttpStatus } from '@nestjs/common';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';

/**
 * The answer of a record-level policy rule (F03): allowed, or denied with
 * the HTTP status and stable `code` the client gets. `NotVisible` is a
 * denial answered as 404, for records the subject must not learn about
 * (rules A1, A2, A10).
 */
export type Decision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly status: HttpStatus;
      readonly code: ErrorCode;
      readonly message: string;
    };

export const Allow: Decision = Object.freeze({ allowed: true });

export function deny(
  status: HttpStatus,
  code: ErrorCode,
  message: string,
): Decision {
  return { allowed: false, status, code, message };
}

export function notVisible(message = 'Not found'): Decision {
  return deny(HttpStatus.NOT_FOUND, ErrorCode.NotFound, message);
}

/** Throws the denial as a `DomainError`; returns when allowed. */
export function enforce(decision: Decision): void {
  if (!decision.allowed) {
    throw new DomainError(decision.status, decision.code, decision.message);
  }
}
