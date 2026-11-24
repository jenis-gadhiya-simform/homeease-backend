import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Who is making the request. Set by the authentication provider (F02). */
export interface Actor {
  /** Staff-side `User` or `CustomerAccount`. */
  kind: 'staff' | 'customer';
  /** `User.id` or `CustomerAccount.id`. */
  userId: string;
  /** Role inside `tenantId`, `PLATFORM_ADMIN`, or `null` until a tenant is resolved (F01). */
  role: string | null;
  /** `null` for platform-level actors (the platform admin) and customers outside a business. */
  tenantId: string | null;
}

export interface RequestContextStore {
  requestId: string;
  ip: string | undefined;
  actor: Actor | undefined;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Per-request values (request id, actor, client IP) available anywhere in the
 * call chain without passing them around or using request-scoped providers.
 * Read by the error envelope, audit (F09), logs and RLS (F01).
 *
 * HTTP requests get a context from `requestContextMiddleware`; workers and
 * tests open one with `RequestContext.run()`.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** The current store, or `undefined` outside a request or job. */
  current(): RequestContextStore | undefined {
    return storage.getStore();
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  actor(): Actor | undefined {
    return storage.getStore()?.actor;
  },

  /** Records the authenticated actor for the rest of the request. */
  setActor(actor: Actor): void {
    const store = storage.getStore();
    if (!store) {
      throw new Error('RequestContext.setActor() called outside a request');
    }
    store.actor = actor;
  },
};

/** Incoming ids are echoed in headers and logs, so accept only safe ones. */
const VALID_REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * The request's id: a well-formed incoming `X-Request-Id`, otherwise a new
 * UUID. Cached on `req.id`, so the context middleware and pino-http (which
 * also calls this) always agree on it, whichever runs first.
 */
export function resolveRequestId(req: IncomingMessage & { id?: unknown }) {
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  req.id = id;
  return id;
}
