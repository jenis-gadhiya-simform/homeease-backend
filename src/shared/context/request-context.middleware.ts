import type { NextFunction, Request, Response } from 'express';
import { RequestContext, resolveRequestId } from './request-context.js';

/**
 * Opens a `RequestContext` for the rest of the request and returns the id in
 * `X-Request-Id`. Registered with `app.use()` in `configureApp()`, so it runs
 * before every other middleware, guard and filter: even a 401 or 429 carries
 * the id.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  RequestContext.run({ requestId, ip: req.ip, actor: undefined }, next);
}
