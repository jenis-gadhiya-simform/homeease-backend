import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  RequestContext,
  resolveRequestId,
} from '../context/request-context.js';
import {
  isExclusionViolation,
  isPrismaError,
  PrismaErrorCode,
} from '../database/prisma-errors.js';
import { DomainError, ErrorCode } from './domain-error.js';

/** The body of every error response. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    /** Per-field messages, for validation errors only. */
    details?: string[];
  };
}

interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: string[];
}

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BadRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthenticated,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.CONFLICT]: ErrorCode.Conflict,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PayloadTooLarge,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RateLimited,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.InternalError,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.ServiceUnavailable,
};

function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? `HTTP_${status}`;
}

const INTERNAL: ApiError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: ErrorCode.InternalError,
  message: 'Internal server error',
};

/** Maps anything thrown to the status, code and message the client sees. */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof DomainError) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const raw =
      typeof body === 'string'
        ? body
        : ((body as { message?: unknown }).message ?? exception.message);

    // The validation pipe throws a 400 with one message per invalid field.
    if (Array.isArray(raw)) {
      const details = raw.map(String);
      return {
        status,
        code:
          status === HttpStatus.BAD_REQUEST
            ? ErrorCode.ValidationFailed
            : codeForStatus(status),
        message:
          status === HttpStatus.BAD_REQUEST
            ? 'Request validation failed'
            : details.join('; '),
        details,
      };
    }
    // Never leak the text of an HttpException someone threw as a 5xx.
    if (status >= 500) {
      return { ...INTERNAL, status, code: codeForStatus(status) };
    }
    return {
      status,
      code: codeForStatus(status),
      message: typeof raw === 'string' ? raw : exception.message,
    };
  }

  // Database constraints a service didn't translate into a domain error.
  if (isPrismaError(exception, PrismaErrorCode.UniqueViolation)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.AlreadyExists,
      message: 'A record with these values already exists',
    };
  }
  if (isPrismaError(exception, PrismaErrorCode.RecordNotFound)) {
    return {
      status: HttpStatus.NOT_FOUND,
      code: ErrorCode.NotFound,
      message: 'Record not found',
    };
  }
  if (isExclusionViolation(exception)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.Conflict,
      message: 'Conflicts with an existing record',
    };
  }

  return INTERNAL;
}

/**
 * The one global exception filter: every error response is
 * `{ "error": { "code", "message", "requestId" } }`. Unexpected errors are
 * logged with the request id and answered with a generic 500.
 *
 * Headers set by the thrower (`Retry-After`, `WWW-Authenticate`) are already
 * on the response and are kept.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = RequestContext.requestId() ?? resolveRequestId(req);
    const { status, code, message, details } = toApiError(exception);

    if (status >= 500) {
      // nestjs-pino logs the Error as `err` and adds `req.id` to the line.
      this.logger.error(
        { err: exception, requestId },
        `${req.method} ${req.url} failed`,
      );
    }

    if (res.headersSent) return;

    const body: ErrorEnvelope = {
      error: { code, message, requestId, ...(details && { details }) },
    };
    res.status(status).json(body);
  }
}
