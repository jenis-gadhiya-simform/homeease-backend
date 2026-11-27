import { HttpStatus } from '@nestjs/common';
import { Policy } from '@nestjs/authorization';
import { MemberRole } from '../../../generated/prisma/client.js';
import {
  isStaffSubject,
  ROLE_RANK,
  type StaffSubject,
  type Subject,
} from '../../../shared/context/subject.js';
import { ErrorCode } from '../../../shared/errors/domain-error.js';
import { Allow, type Decision, deny } from '../decision.js';

export const ROLE_LABELS: Record<MemberRole, string> = {
  [MemberRole.OWNER]: 'Owner',
  [MemberRole.MANAGER]: 'Manager',
  [MemberRole.RECEPTIONIST]: 'Receptionist',
  [MemberRole.STAFF]: 'Staff',
};

/** Only Owners and Managers manage the team (F04); rank decides whom. */
const MANAGES_TEAM = ROLE_RANK[MemberRole.MANAGER];

/** The member being acted on. */
export interface MemberTarget {
  userId: string;
  role: MemberRole;
}

const ownershipTransferRequired = (message: string) =>
  deny(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.OwnershipTransferRequired,
    `${message}: ownership moves only by transfer`,
  );

const rankTooLow = (actor: MemberRole, target: MemberRole) =>
  deny(
    HttpStatus.FORBIDDEN,
    ErrorCode.RoleRankTooLow,
    `A ${ROLE_LABELS[actor]} cannot manage ${ROLE_LABELS[target]} members`,
  );

/** Rule A8: `rank(actor) > rank(target)`; nobody manages the OWNER role. */
export function outranks(actor: MemberRole, target: MemberRole): boolean {
  return target !== MemberRole.OWNER && ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * Who may add, change and remove team members (F03 rule A8, F04 role
 * table). Owners and Managers reach the routes; each change also needs the
 * actor to outrank the role involved. OWNER is never added, given, taken or
 * removed here: 422 `OWNERSHIP_TRANSFER_REQUIRED` (checked first).
 */
@Policy()
export class MemberPolicy {
  /** Route ability: may this subject manage members at all? */
  manage(subject: Subject | null): boolean {
    return isStaffSubject(subject) && ROLE_RANK[subject.role] >= MANAGES_TEAM;
  }

  add(subject: StaffSubject, role: MemberRole): Decision {
    if (role === MemberRole.OWNER) {
      return ownershipTransferRequired('An Owner cannot be added');
    }
    return outranks(subject.role, role)
      ? Allow
      : rankTooLow(subject.role, role);
  }

  /** Role and/or calendar. The Owner may change their own calendar. */
  update(
    subject: StaffSubject,
    target: MemberTarget,
    newRole: MemberRole = target.role,
  ): Decision {
    if (
      newRole !== target.role &&
      (newRole === MemberRole.OWNER || target.role === MemberRole.OWNER)
    ) {
      return ownershipTransferRequired('The Owner role cannot be changed');
    }
    const acting = this.actOn(subject, target);
    if (!acting.allowed || newRole === target.role) return acting;
    return outranks(subject.role, newRole)
      ? Allow
      : rankTooLow(subject.role, newRole);
  }

  remove(subject: StaffSubject, target: MemberTarget): Decision {
    if (target.role === MemberRole.OWNER) {
      return ownershipTransferRequired('The Owner cannot be removed');
    }
    return outranks(subject.role, target.role)
      ? Allow
      : rankTooLow(subject.role, target.role);
  }

  resendSetup(subject: StaffSubject, target: MemberTarget): Decision {
    return this.actOn(subject, target);
  }

  private actOn(subject: StaffSubject, target: MemberTarget): Decision {
    if (subject.userId === target.userId && target.role === MemberRole.OWNER) {
      return Allow;
    }
    return outranks(subject.role, target.role)
      ? Allow
      : rankTooLow(subject.role, target.role);
  }
}
