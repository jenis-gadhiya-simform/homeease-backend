import type { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import type { Principal } from '../auth/auth.types.js';
import type { MembershipsRepository } from './repositories/memberships.repository.js';
import { TenantResolver } from './tenant-resolver.js';

const A = '0193a0a0-0000-7000-8000-00000000000a';
const B = '0193a0a0-0000-7000-8000-00000000000b';
const C = '0193a0a0-0000-7000-8000-00000000000c';

const staff: Principal = {
  kind: 'staff',
  id: 'u1',
  email: 'u@x',
  name: 'U',
  isPlatformAdmin: false,
};

describe('TenantResolver', () => {
  const findActiveForUser = vi.fn();
  const resolver = new TenantResolver(
    {
      runAsUser: (_userId: string, fn: (tx: unknown) => unknown) => fn({}),
    } as unknown as TenantPrismaService,
    { findActiveForUser } as unknown as MembershipsRepository,
  );
  const membership = (
    tenantId: string,
    role = 'OWNER',
    status = 'ACTIVE',
    staffId: string | null = null,
  ) => ({ tenantId, role, staffId, tenant: { status } });

  beforeEach(() => findActiveForUser.mockReset());

  it('uses the only membership when no header is sent, with its calendar', async () => {
    findActiveForUser.mockResolvedValue([
      membership(A, 'STAFF', 'ACTIVE', 's1'),
    ]);
    await expect(resolver.resolve(staff, {})).resolves.toEqual({
      kind: 'staff',
      userId: 'u1',
      tenantId: A,
      role: 'STAFF',
      staffId: 's1',
    });
  });

  it('picks the business named by X-Tenant-Id', async () => {
    findActiveForUser.mockResolvedValue([
      membership(A),
      membership(B, 'MANAGER'),
    ]);
    await expect(
      resolver.resolve(staff, { 'x-tenant-id': B }),
    ).resolves.toMatchObject({ tenantId: B, role: 'MANAGER' });
  });

  it('needs the header with several memberships', async () => {
    findActiveForUser.mockResolvedValue([membership(A), membership(B)]);
    await expect(resolver.resolve(staff, {})).rejects.toMatchObject({
      code: 'TENANT_REQUIRED',
    });
  });

  it('rejects a business the user is not a member of', async () => {
    findActiveForUser.mockResolvedValue([membership(A)]);
    await expect(
      resolver.resolve(staff, { 'x-tenant-id': C }),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    findActiveForUser.mockResolvedValue([]);
    await expect(resolver.resolve(staff, {})).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
  });

  it('rejects a malformed X-Tenant-Id', async () => {
    findActiveForUser.mockResolvedValue([membership(A)]);
    await expect(
      resolver.resolve(staff, { 'x-tenant-id': 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a suspended business with 403 TENANT_SUSPENDED (A12)', async () => {
    findActiveForUser.mockResolvedValue([membership(A, 'OWNER', 'SUSPENDED')]);
    await expect(resolver.resolve(staff, {})).rejects.toMatchObject({
      code: 'TENANT_SUSPENDED',
    });
  });

  it('rejects customers without reading memberships', async () => {
    const customer: Principal = {
      kind: 'customer',
      id: 'c1',
      email: 'c@x',
      hasPassword: false,
      emailVerified: true,
    };
    await expect(resolver.resolve(customer, {})).rejects.toMatchObject({
      code: 'WRONG_ACCOUNT_TYPE',
    });
    expect(findActiveForUser).not.toHaveBeenCalled();
  });
});
