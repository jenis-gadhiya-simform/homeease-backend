import { Prisma } from '../../generated/prisma/client.js';

/**
 * Prisma error codes the app reacts to.
 * Full list: https://www.prisma.io/docs/orm/reference/error-reference
 */
export const PrismaErrorCode = {
  /** Unique constraint failed. */
  UniqueViolation: 'P2002',
  /** Foreign key constraint failed. */
  ForeignKeyViolation: 'P2003',
  /** A record the operation depends on was not found (update/delete). */
  RecordNotFound: 'P2025',
  /** Write conflict or deadlock (Postgres `40001` / `40P01`): retry the transaction. */
  TransactionConflict: 'P2034',
} as const;

type PrismaErrorCode = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

/**
 * Raw PostgreSQL SQLSTATE codes Prisma has no code of its own for. They reach
 * the app as `P2010` (raw query) or `P2039` (model query) with the original
 * code inside `meta.driverAdapterError`.
 */
export const PostgresErrorCode = {
  /** An exclusion constraint (`EXCLUDE USING gist …`) rejected the row: overlapping booking. */
  ExclusionViolation: '23P01',
  /** `SERIALIZABLE` transaction could not be serialized: retry it. */
  SerializationFailure: '40001',
} as const;

export function isPrismaError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/** `error.name` of the wrapper Prisma's driver adapters throw. */
const DRIVER_ADAPTER_ERROR = 'DriverAdapterError';

interface DriverAdapterErrorLike {
  name: typeof DRIVER_ADAPTER_ERROR;
  cause: { originalCode?: string };
}

function isDriverAdapterError(value: unknown): value is DriverAdapterErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === DRIVER_ADAPTER_ERROR &&
    typeof (value as { cause?: unknown }).cause === 'object'
  );
}

/**
 * The PostgreSQL SQLSTATE behind a Prisma error (e.g. `23P01`), when the
 * driver adapter reported one. Also accepts the adapter's own error, which
 * can surface unwrapped from interactive transactions.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  const adapterError =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta?.driverAdapterError
      : error;
  return isDriverAdapterError(adapterError)
    ? adapterError.cause.originalCode
    : undefined;
}

/** An exclusion constraint rejected the write (`23P01`): map to 409. */
export function isExclusionViolation(error: unknown): boolean {
  return postgresErrorCode(error) === PostgresErrorCode.ExclusionViolation;
}

/** A `SERIALIZABLE` transaction lost a conflict (`40001`): safe to retry. */
export function isSerializationFailure(error: unknown): boolean {
  return postgresErrorCode(error) === PostgresErrorCode.SerializationFailure;
}
