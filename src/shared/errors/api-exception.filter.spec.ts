import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client.js';
import { RequestContext } from '../context/request-context.js';
import { ApiExceptionFilter, toApiError } from './api-exception.filter.js';
import { DomainError, ErrorCode } from './domain-error.js';

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('toApiError', () => {
  it('keeps a domain error’s status, code and message', () => {
    expect(
      toApiError(
        new DomainError(HttpStatus.CONFLICT, ErrorCode.SlotTaken, 'Taken'),
      ),
    ).toEqual({ status: 409, code: 'SLOT_TAKEN', message: 'Taken' });
  });

  it('derives the code of a plain HttpException from its status', () => {
    expect(toApiError(new NotFoundException('No such booking'))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'No such booking',
    });
    expect(toApiError(new ThrottlerException())).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('turns validation messages into details', () => {
    expect(
      toApiError(new BadRequestException(['to: Invalid email address'])),
    ).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: ['to: Invalid email address'],
    });
  });

  it('hides the text of a thrown 5xx HttpException', () => {
    expect(
      toApiError(new InternalServerErrorException('db password is hunter2')),
    ).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps unhandled database constraint errors', () => {
    expect(toApiError(knownError('P2002'))).toMatchObject({
      status: 409,
      code: 'ALREADY_EXISTS',
    });
    expect(toApiError(knownError('P2025'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(
      toApiError(
        knownError('P2039', {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: { originalCode: '23P01' },
          },
        }),
      ),
    ).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('answers anything else with a generic 500', () => {
    expect(toApiError(new Error('secret detail'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(toApiError('a string')).toMatchObject({ status: 500 });
  });
});

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  function httpHost() {
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const req = { method: 'GET', url: '/x', headers: {} };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
    return { host, res };
  }

  afterEach(() => vi.restoreAllMocks());

  it('writes the envelope with the request id from the context', () => {
    const { host, res } = httpHost();
    RequestContext.run(
      { requestId: 'req-1', ip: undefined, actor: undefined },
      () =>
        filter.catch(
          new DomainError(HttpStatus.CONFLICT, ErrorCode.SlotTaken, 'Taken'),
          host,
        ),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'SLOT_TAKEN', message: 'Taken', requestId: 'req-1' },
    });
  });

  it('logs unexpected errors with the request id, and only those', () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const boom = new Error('boom');

    RequestContext.run(
      { requestId: 'req-2', ip: undefined, actor: undefined },
      () => {
        filter.catch(new NotFoundException(), httpHost().host);
        filter.catch(boom, httpHost().host);
      },
    );

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      { err: boom, requestId: 'req-2' },
      'GET /x failed',
    );
  });

  it('falls back to a generated request id outside a context', () => {
    const { host, res } = httpHost();
    filter.catch(new NotFoundException(), host);
    const body = res.json.mock.calls[0][0] as {
      error: { requestId: string };
    };
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
