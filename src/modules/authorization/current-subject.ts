import { RequestContext } from '../../shared/context/request-context.js';
import {
  isStaffSubject,
  type StaffSubject,
} from '../../shared/context/subject.js';

/**
 * The member acting in this request (`@TenantScoped()` routes), as resolved
 * before the handler ran. Throws when called elsewhere: a programming error.
 */
export function requireStaffSubject(): StaffSubject {
  const subject = RequestContext.subject();
  if (!isStaffSubject(subject)) {
    throw new Error(
      'No staff subject in RequestContext: is the route @TenantScoped() with @Roles() or @UsePolicy()?',
    );
  }
  return subject;
}
