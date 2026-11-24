import type { MemberRole } from '../../generated/prisma/client.js';
import { assertCanManageRole, canManageRole } from './team-roles.js';

describe('team roles', () => {
  it.each<[MemberRole, MemberRole[]]>([
    ['OWNER', ['MANAGER', 'RECEPTIONIST', 'STAFF']],
    ['MANAGER', ['RECEPTIONIST', 'STAFF']],
    ['RECEPTIONIST', []],
    ['STAFF', []],
  ])('%s manages exactly %j', (actor, allowed) => {
    const roles: MemberRole[] = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'STAFF'];
    for (const target of roles) {
      expect(canManageRole(actor, target)).toBe(allowed.includes(target));
    }
  });

  it('nobody manages the Owner role', () => {
    expect(canManageRole('OWNER', 'OWNER')).toBe(false);
  });

  it('throws 403 FORBIDDEN when not allowed', () => {
    expect(() => assertCanManageRole('MANAGER', 'MANAGER')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
    );
    expect(() => assertCanManageRole('OWNER', 'MANAGER')).not.toThrow();
  });
});
