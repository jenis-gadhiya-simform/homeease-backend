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
} as const;

type PrismaErrorCode = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

export function isPrismaError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
