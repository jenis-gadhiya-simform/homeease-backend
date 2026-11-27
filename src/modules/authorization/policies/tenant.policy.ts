import { HttpStatus } from '@nestjs/common';
import { Policy } from '@nestjs/authorization';
import { MemberRole, UserStatus } from '../../../generated/prisma/client.js';
import {
  isStaffSubject,
  type StaffSubject,
  type Subject,
} from '../../../shared/context/subject.js';
import { ErrorCode } from '../../../shared/errors/domain-error.js';
import { Allow, type Decision, deny } from '../decision.js';

/** The member ownership would go to. */
export interface TransferTarget {
  userId: string;
  role: MemberRole;
  userStatus: UserStatus;
}

/**
 * Ownership transfer (F03 `TenantPolicy.transferOwnership`): only the Owner,
 * with their password re-entered, and only to another active Manager who
 * has set up their account.
 */
@Policy()
export class TenantPolicy {
  /** Route ability: only the Owner reaches the transfer. */
  transferOwnership(subject: Subject | null): boolean {
    return isStaffSubject(subject) && subject.role === MemberRole.OWNER;
  }

  transferTo(
    subject: StaffSubject,
    target: TransferTarget,
    passwordConfirmed: boolean,
  ): Decision {
    if (subject.role !== MemberRole.OWNER) {
      return deny(
        HttpStatus.FORBIDDEN,
        ErrorCode.Forbidden,
        'Only the Owner can transfer ownership',
      );
    }
    if (!passwordConfirmed) {
      return deny(
        HttpStatus.FORBIDDEN,
        ErrorCode.ReauthenticationRequired,
        'The password is incorrect',
      );
    }
    if (target.userId === subject.userId) {
      return deny(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.TransferTargetInvalid,
        'You already own this business',
      );
    }
    if (target.role !== MemberRole.MANAGER) {
      return deny(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.TransferTargetInvalid,
        'Ownership can only be transferred to a Manager',
      );
    }
    if (target.userStatus !== UserStatus.ACTIVE) {
      return deny(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.TransferTargetInvalid,
        'The Manager has not set up their account yet',
      );
    }
    return Allow;
  }
}
