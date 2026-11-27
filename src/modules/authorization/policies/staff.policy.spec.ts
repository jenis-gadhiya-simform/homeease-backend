import type { MemberRole } from '../../../generated/prisma/client.js';
import type { StaffSubject } from '../../../shared/context/subject.js';
import { StaffPolicy } from './staff.policy.js';

const as = (role: MemberRole, staffId: string | null): StaffSubject => ({
  kind: 'staff',
  userId: `u-${staffId}`,
  tenantId: 't1',
  role,
  staffId,
});

describe('StaffPolicy', () => {
  const policy = new StaffPolicy();
  const maya = { id: 's-maya' };

  it('any member reaches the route; non-members do not', () => {
    expect(policy.update(as('STAFF', null))).toBe(true);
    expect(policy.update({ kind: 'customer', accountId: 'c' })).toBe(false);
    expect(policy.update(null)).toBe(false);
  });

  it('same role, different answer: Staff renames only their own calendar', () => {
    expect(
      policy.updateCalendar(as('STAFF', 's-maya'), maya, { displayName: 'M' })
        .allowed,
    ).toBe(true);
    expect(
      policy.updateCalendar(as('STAFF', 's-ravi'), maya, { displayName: 'M' }),
    ).toMatchObject({ allowed: false, status: 403, code: 'FORBIDDEN' });
  });

  it('only Owner and Manager (de)activate a calendar, their own included', () => {
    for (const role of ['STAFF', 'RECEPTIONIST'] as const) {
      expect(
        policy.updateCalendar(as(role, 's-maya'), maya, { active: false })
          .allowed,
      ).toBe(false);
    }
    for (const role of ['OWNER', 'MANAGER'] as const) {
      expect(
        policy.updateCalendar(as(role, null), maya, { active: false }).allowed,
      ).toBe(true);
    }
  });
});
