import { MemberRole } from '../../../generated/prisma/client.js';
import type { StaffSubject, Subject } from '../../../shared/context/subject.js';
import { MemberPolicy, outranks } from './member.policy.js';

const ROLES = Object.values(MemberRole);
const as = (role: MemberRole, userId = 'actor'): StaffSubject => ({
  kind: 'staff',
  userId,
  tenantId: 't1',
  role,
  staffId: null,
});
const target = (role: MemberRole, userId = 'target') => ({ userId, role });

describe('MemberPolicy', () => {
  const policy = new MemberPolicy();

  describe('manage (route)', () => {
    it.each<[MemberRole, boolean]>([
      ['OWNER', true],
      ['MANAGER', true],
      ['RECEPTIONIST', false],
      ['STAFF', false],
    ])('%s → %s', (role, allowed) => {
      expect(policy.manage(as(role))).toBe(allowed);
    });

    it.each<Subject | null>([
      null,
      { kind: 'customer', accountId: 'c' },
      { kind: 'platform', userId: 'p' },
      { kind: 'user', userId: 'u' },
    ])('denies non-members (%j)', (subject) => {
      expect(policy.manage(subject)).toBe(false);
    });
  });

  describe('A8 role rank', () => {
    it.each<[MemberRole, MemberRole[]]>([
      ['OWNER', ['MANAGER', 'RECEPTIONIST', 'STAFF']],
      ['MANAGER', ['RECEPTIONIST', 'STAFF']],
      ['RECEPTIONIST', ['STAFF']],
      ['STAFF', []],
    ])('%s outranks exactly %j', (actor, below) => {
      for (const role of ROLES) {
        expect(outranks(actor, role)).toBe(below.includes(role));
      }
    });

    it('Manager removes a Receptionist; not another Manager (ROLE_RANK_TOO_LOW)', () => {
      expect(policy.remove(as('MANAGER'), target('RECEPTIONIST'))).toEqual({
        allowed: true,
      });
      expect(policy.remove(as('MANAGER'), target('MANAGER'))).toMatchObject({
        allowed: false,
        status: 403,
        code: 'ROLE_RANK_TOO_LOW',
      });
    });

    it('add: Owner adds a Manager; a Manager cannot', () => {
      expect(policy.add(as('OWNER'), 'MANAGER').allowed).toBe(true);
      expect(policy.add(as('MANAGER'), 'MANAGER')).toMatchObject({
        code: 'ROLE_RANK_TOO_LOW',
      });
    });

    it('update: promoting needs to outrank the new role too', () => {
      expect(
        policy.update(as('MANAGER'), target('RECEPTIONIST'), 'STAFF').allowed,
      ).toBe(true);
      expect(
        policy.update(as('MANAGER'), target('RECEPTIONIST'), 'MANAGER'),
      ).toMatchObject({ code: 'ROLE_RANK_TOO_LOW' });
      expect(policy.update(as('MANAGER'), target('OWNER', 'o'))).toMatchObject({
        code: 'ROLE_RANK_TOO_LOW',
      });
    });
  });

  describe('OWNER only moves by transfer (checked before rank)', () => {
    it.each<MemberRole>(['OWNER', 'MANAGER'])(
      '%s cannot add, give, take or remove OWNER',
      (actor) => {
        const code = { code: 'OWNERSHIP_TRANSFER_REQUIRED', status: 422 };
        expect(policy.add(as(actor), 'OWNER')).toMatchObject(code);
        expect(
          policy.update(as(actor), target('MANAGER'), 'OWNER'),
        ).toMatchObject(code);
        expect(
          policy.update(as(actor), target('OWNER', 'o'), 'MANAGER'),
        ).toMatchObject(code);
        expect(policy.remove(as(actor), target('OWNER', 'o'))).toMatchObject(
          code,
        );
      },
    );

    it('the Owner may change their own membership (e.g. become bookable)', () => {
      const owner = as('OWNER', 'o');
      expect(policy.update(owner, target('OWNER', 'o')).allowed).toBe(true);
      expect(policy.resendSetup(owner, target('OWNER', 'o')).allowed).toBe(
        true,
      );
    });
  });
});
