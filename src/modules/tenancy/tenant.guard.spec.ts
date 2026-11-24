import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../shared/context/request-context.js';
import type { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import type { Principal } from '../auth/auth.types.js';
import type { MembershipsRepository } from './repositories/memberships.repository.js';
import { TenantGuard, TenantScoped } from './tenant.guard.js';

const A = '0193a0a0-0000-7000-8000-00000000000a';
const B = '0193a0a0-0000-7000-8000-00000000000b';
const C = '0193a0a0-0000-7000-8000-00000000000c';

class Routes {
  @TenantScoped()
  anyMember() {}

  @TenantScoped('OWNER', 'MANAGER')
  managersOnly() {}
}

const staff: Principal = {
  kind: 'staff',
  id: 'u1',
  email: 'u@x',
  name: 'U',
  isPlatformAdmin: false,
};

function context(
  handler: keyof Routes,
  user: Principal | undefined,
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  const findActiveForUser = vi.fn();
  const guard = new TenantGuard(
    new Reflector(),
    {
      runAsUser: (_userId: string, fn: (tx: unknown) => unknown) => fn({}),
    } as unknown as TenantPrismaService,
    { findActiveForUser } as unknown as MembershipsRepository,
  );
  const membership = (tenantId: string, role = 'OWNER', status = 'ACTIVE') => ({
    tenantId,
    role,
    tenant: { status },
  });

  /** Runs the guard inside a request context; returns the actor it set. */
  async function run(ctx: ExecutionContext) {
    return RequestContext.run(
      { requestId: 'r', ip: undefined, actor: undefined },
      async () => {
        await guard.canActivate(ctx);
        return RequestContext.actor();
      },
    );
  }

  beforeEach(() => findActiveForUser.mockReset());

  it('uses the only membership when no header is sent', async () => {
    findActiveForUser.mockResolvedValue([membership(A, 'STAFF')]);
    await expect(run(context('anyMember', staff))).resolves.toEqual({
      kind: 'staff',
      userId: 'u1',
      role: 'STAFF',
      tenantId: A,
    });
  });

  it('picks the business named by X-Tenant-Id', async () => {
    findActiveForUser.mockResolvedValue([
      membership(A),
      membership(B, 'MANAGER'),
    ]);
    const actor = await run(context('anyMember', staff, { 'x-tenant-id': B }));
    expect(actor).toMatchObject({ tenantId: B, role: 'MANAGER' });
  });

  it('needs the header with several memberships', async () => {
    findActiveForUser.mockResolvedValue([membership(A), membership(B)]);
    await expect(run(context('anyMember', staff))).rejects.toMatchObject({
      code: 'TENANT_REQUIRED',
    });
  });

  it('rejects a business the user is not a member of', async () => {
    findActiveForUser.mockResolvedValue([membership(A)]);
    await expect(
      run(context('anyMember', staff, { 'x-tenant-id': C })),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    findActiveForUser.mockResolvedValue([]);
    await expect(run(context('anyMember', staff))).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
  });

  it('rejects a malformed X-Tenant-Id', async () => {
    findActiveForUser.mockResolvedValue([membership(A)]);
    await expect(
      run(context('anyMember', staff, { 'x-tenant-id': 'nope' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a suspended business with 403 TENANT_SUSPENDED', async () => {
    findActiveForUser.mockResolvedValue([membership(A, 'OWNER', 'SUSPENDED')]);
    await expect(run(context('anyMember', staff))).rejects.toMatchObject({
      code: 'TENANT_SUSPENDED',
    });
  });

  it('enforces the route roles', async () => {
    findActiveForUser.mockResolvedValue([membership(A, 'RECEPTIONIST')]);
    await expect(run(context('managersOnly', staff))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    findActiveForUser.mockResolvedValue([membership(A, 'MANAGER')]);
    await expect(run(context('managersOnly', staff))).resolves.toMatchObject({
      role: 'MANAGER',
    });
  });

  it('rejects customers', async () => {
    const customer: Principal = {
      kind: 'customer',
      id: 'c1',
      email: 'c@x',
      hasPassword: false,
      emailVerified: true,
    };
    await expect(run(context('anyMember', customer))).rejects.toMatchObject({
      code: 'WRONG_ACCOUNT_TYPE',
    });
    expect(findActiveForUser).not.toHaveBeenCalled();
  });
});
