import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Keeps Terminus' own 503 body on a failed probe
 * (`{ status: 'error', info, error, details }`), so it still says which
 * dependency is down. Controller-scoped, so it wins over the global
 * `ApiExceptionFilter` for these routes only.
 */
@Catch(ServiceUnavailableException)
export class HealthCheckFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
