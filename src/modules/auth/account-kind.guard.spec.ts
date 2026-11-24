import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../shared/errors/domain-error.js';
import {
  AccountKindGuard,
  CustomerOnly,
  StaffOnly,
} from './account-kind.guard.js';
import type { Principal } from './auth.types.js';

class Routes {
  @StaffOnly()
  staff() {}

  @CustomerOnly()
  customer() {}

  open() {}
}

const staff: Principal = {
  kind: 'staff',
  id: 's1',
  email: 's@x',
  name: 'S',
  isPlatformAdmin: false,
};
const customer: Principal = {
  kind: 'customer',
  id: 'c1',
  email: 'c@x',
  hasPassword: false,
  emailVerified: true,
};

function context(handler: keyof Routes, user?: Principal): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AccountKindGuard', () => {
  const guard = new AccountKindGuard(new Reflector());

  it('lets the right kind through', () => {
    expect(guard.canActivate(context('staff', staff))).toBe(true);
    expect(guard.canActivate(context('customer', customer))).toBe(true);
  });

  it('rejects the other kind with 403 WRONG_ACCOUNT_TYPE', () => {
    for (const [handler, user] of [
      ['staff', customer],
      ['customer', staff],
    ] as const) {
      try {
        guard.canActivate(context(handler, user));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).getStatus()).toBe(403);
        expect((error as DomainError).code).toBe('WRONG_ACCOUNT_TYPE');
      }
    }
  });

  it('ignores routes without a kind', () => {
    expect(guard.canActivate(context('open', customer))).toBe(true);
  });
});
