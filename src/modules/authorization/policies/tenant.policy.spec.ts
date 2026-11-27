import type {
  MemberRole,
  UserStatus,
} from '../../../generated/prisma/client.js';
import type { StaffSubject } from '../../../shared/context/subject.js';
import { TenantPolicy } from './tenant.policy.js';

const as = (role: MemberRole): StaffSubject => ({
  kind: 'staff',
  userId: 'owner',
  tenantId: 't1',
  role,
  staffId: null,
});
const manager = (
  role: MemberRole = 'MANAGER',
  userStatus: UserStatus = 'ACTIVE',
  userId = 'm1',
) => ({ userId, role, userStatus });

describe('TenantPolicy', () => {
  const policy = new TenantPolicy();

  it('only the Owner reaches the transfer route', () => {
    expect(policy.transferOwnership(as('OWNER'))).toBe(true);
    for (const role of ['MANAGER', 'RECEPTIONIST', 'STAFF'] as const) {
      expect(policy.transferOwnership(as(role))).toBe(false);
    }
    expect(policy.transferOwnership({ kind: 'platform', userId: 'p' })).toBe(
      false,
    );
  });

  it('allows a transfer to an active Manager with the password confirmed', () => {
    expect(policy.transferTo(as('OWNER'), manager(), true).allowed).toBe(true);
  });

  it('needs the password re-entered', () => {
    expect(policy.transferTo(as('OWNER'), manager(), false)).toMatchObject({
      status: 403,
      code: 'REAUTHENTICATION_REQUIRED',
    });
  });

  it.each([
    ['not a Manager', manager('RECEPTIONIST')],
    ['setup not finished', manager('MANAGER', 'PENDING_SETUP')],
    ['themself', manager('OWNER', 'ACTIVE', 'owner')],
  ])('refuses a target that is %s (422)', (_label, target) => {
    expect(policy.transferTo(as('OWNER'), target, true)).toMatchObject({
      status: 422,
      code: 'TRANSFER_TARGET_INVALID',
    });
  });

  it('refuses anyone but the Owner even past the route', () => {
    expect(policy.transferTo(as('MANAGER'), manager(), true)).toMatchObject({
      status: 403,
    });
  });
});
