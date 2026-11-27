import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../shared/context/request-context.js';
import type { StaffSubject } from '../../shared/context/subject.js';
import type { Principal } from '../auth/auth.types.js';
import {
  TenantScoped,
  type TenantResolver,
} from '../tenancy/tenant-resolver.js';
import { SubjectResolver, subjectOf } from './subject.resolver.js';

class Routes {
  @TenantScoped()
  tenant() {}
  outside() {}
}

const staffUser: Principal = {
  kind: 'staff',
  id: 'u1',
  email: 'u@x',
  name: 'U',
  isPlatformAdmin: false,
};

function context(
  handler: keyof Routes,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('SubjectResolver', () => {
  const member: StaffSubject = {
    kind: 'staff',
    userId: 'u1',
    tenantId: 't1',
    role: 'STAFF',
    staffId: 's1',
  };
  const resolve = vi.fn();
  const resolver = new SubjectResolver(new Reflector(), {
    resolve,
  } as unknown as TenantResolver);

  beforeEach(() => resolve.mockReset().mockResolvedValue(member));

  const inRequest = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ requestId: 'r', ip: undefined, actor: undefined }, fn);

  it('on tenant routes: the membership, stored in RequestContext with the actor', async () => {
    const req = { user: staffUser, headers: {} };
    const result = await inRequest(async () => {
      const subject = await resolver.resolve(context('tenant', req));
      return {
        subject,
        stored: RequestContext.subject(),
        actor: RequestContext.actor(),
      };
    });
    expect(result.subject).toEqual(member);
    expect(result.stored).toEqual(member);
    expect(result.actor).toEqual({
      kind: 'staff',
      userId: 'u1',
      role: 'STAFF',
      tenantId: 't1',
    });
  });

  it('resolves once per request', async () => {
    const req = { user: staffUser, headers: {} };
    await inRequest(async () => {
      await resolver.resolve(context('tenant', req));
      await resolver.resolve(context('tenant', req));
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('outside tenant routes: no membership read', async () => {
    const subject = await inRequest(() =>
      resolver.resolve(context('outside', { user: staffUser, headers: {} })),
    );
    expect(subject).toEqual({ kind: 'user', userId: 'u1' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('maps principals', () => {
    expect(subjectOf(null)).toBeNull();
    expect(subjectOf({ ...staffUser, isPlatformAdmin: true })).toEqual({
      kind: 'platform',
      userId: 'u1',
    });
    expect(
      subjectOf({
        kind: 'customer',
        id: 'c1',
        email: 'c@x',
        hasPassword: false,
        emailVerified: true,
      }),
    ).toEqual({ kind: 'customer', accountId: 'c1' });
  });
});
