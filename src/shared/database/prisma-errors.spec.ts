import { Prisma } from '../../generated/prisma/client.js';
import {
  isExclusionViolation,
  isPrismaError,
  isSerializationFailure,
  PrismaErrorCode,
  postgresErrorCode,
} from './prisma-errors.js';

/** The error Prisma's pg adapter raises for a Postgres error it has no code for. */
function driverAdapterError(originalCode: string) {
  return {
    name: 'DriverAdapterError',
    message: 'driver error',
    cause: { kind: 'postgres', originalCode, originalMessage: 'boom' },
  };
}

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('prisma-errors', () => {
  it('matches Prisma codes', () => {
    const error = knownError(PrismaErrorCode.UniqueViolation);
    expect(isPrismaError(error, PrismaErrorCode.UniqueViolation)).toBe(true);
    expect(isPrismaError(error, PrismaErrorCode.RecordNotFound)).toBe(false);
    expect(isPrismaError(new Error('x'), PrismaErrorCode.UniqueViolation)).toBe(
      false,
    );
  });

  it('reads the Postgres code of a model query (P2039) or raw query (P2010)', () => {
    for (const code of ['P2039', 'P2010']) {
      const error = knownError(code, {
        driverAdapterError: driverAdapterError('23P01'),
      });
      expect(postgresErrorCode(error)).toBe('23P01');
      expect(isExclusionViolation(error)).toBe(true);
      expect(isSerializationFailure(error)).toBe(false);
    }
  });

  it('recognises a serialization failure (P2034 from 40001)', () => {
    const error = knownError(PrismaErrorCode.TransactionConflict, {
      driverAdapterError: driverAdapterError('40001'),
    });
    expect(isSerializationFailure(error)).toBe(true);
  });

  it('accepts an unwrapped driver adapter error', () => {
    expect(isExclusionViolation(driverAdapterError('23P01'))).toBe(true);
  });

  it('returns undefined for anything else', () => {
    expect(postgresErrorCode(new Error('x'))).toBeUndefined();
    expect(postgresErrorCode(knownError('P2002'))).toBeUndefined();
    expect(postgresErrorCode(null)).toBeUndefined();
  });
});
