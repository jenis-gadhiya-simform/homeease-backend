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

/**
 * Staff calendars (F03 `StaffPolicy.update`). Owner and Manager change any
 * calendar; any other member only renames their own (`subject.staffId`):
 * same role, different answer depending on the record.
 */
@Policy()
export class StaffPolicy {
  /** Route ability: any member reaches `PATCH /staff/:id`; the record decides. */
  update(subject: Subject | null): boolean {
    return isStaffSubject(subject);
  }

  updateCalendar(
    subject: StaffSubject,
    calendar: { id: string },
    changes: { displayName?: string; active?: boolean },
  ): Decision {
    if (ROLE_RANK[subject.role] >= ROLE_RANK[MemberRole.MANAGER]) return Allow;
    const own = calendar.id === subject.staffId;
    if (own && changes.active === undefined) return Allow;
    return deny(
      HttpStatus.FORBIDDEN,
      ErrorCode.Forbidden,
      own
        ? 'Only an Owner or Manager can activate or deactivate a calendar'
        : 'You can only change your own calendar',
    );
  }
}
