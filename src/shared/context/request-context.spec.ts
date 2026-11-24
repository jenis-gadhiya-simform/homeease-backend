import type { NextFunction, Request, Response } from 'express';
import { requestContextMiddleware } from './request-context.middleware.js';
import { RequestContext, resolveRequestId } from './request-context.js';

function fakeRequest(headers: Record<string, string> = {}) {
  return { headers, ip: '203.0.113.7' } as unknown as Request & {
    id?: string;
  };
}

describe('resolveRequestId', () => {
  it('adopts a well-formed incoming X-Request-Id', () => {
    const req = fakeRequest({ 'x-request-id': 'abc-123.x_y' });
    expect(resolveRequestId(req)).toBe('abc-123.x_y');
  });

  it.each(['has spaces', 'new\nline', 'x'.repeat(129), ''])(
    'replaces an unsafe incoming id (%j) with a UUID',
    (incoming) => {
      const id = resolveRequestId(fakeRequest({ 'x-request-id': incoming }));
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('returns the same id on every call for one request', () => {
    const req = fakeRequest();
    expect(resolveRequestId(req)).toBe(resolveRequestId(req));
    expect(req.id).toBe(resolveRequestId(req));
  });
});

describe('RequestContext', () => {
  it('is empty outside a request', () => {
    expect(RequestContext.current()).toBeUndefined();
    expect(RequestContext.requestId()).toBeUndefined();
    expect(() =>
      RequestContext.setActor({
        kind: 'staff',
        userId: 'u',
        role: 'OWNER',
        tenantId: 't',
      }),
    ).toThrow(/outside a request/);
  });

  it('keeps values across awaits and lets the actor be set later', async () => {
    await RequestContext.run(
      { requestId: 'r1', ip: '::1', actor: undefined },
      async () => {
        await Promise.resolve();
        RequestContext.setActor({
          kind: 'staff',
          userId: 'u1',
          role: 'OWNER',
          tenantId: 't1',
        });
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(RequestContext.requestId()).toBe('r1');
        expect(RequestContext.actor()).toEqual({
          kind: 'staff',
          userId: 'u1',
          role: 'OWNER',
          tenantId: 't1',
        });
      },
    );
  });

  it('keeps concurrent requests apart', async () => {
    const seen = await Promise.all(
      ['a', 'b'].map((requestId) =>
        RequestContext.run(
          { requestId, ip: undefined, actor: undefined },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return RequestContext.requestId();
          },
        ),
      ),
    );
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('requestContextMiddleware', () => {
  it('opens a context for next() and echoes the id in X-Request-Id', () => {
    const req = fakeRequest({ 'x-request-id': 'req-42' });
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;
    let inside: ReturnType<typeof RequestContext.current>;
    const next: NextFunction = () => {
      inside = RequestContext.current();
    };

    requestContextMiddleware(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-42');
    expect(inside!).toEqual({
      requestId: 'req-42',
      ip: '203.0.113.7',
      actor: undefined,
    });
  });
});
