import { HttpStatus } from '@nestjs/common';
import type { MemberRole } from '../../generated/prisma/client.js';
import { RequestContext } from '../../shared/context/request-context.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';

/**
 * Who can add, change and remove whom (F04). Nobody adds an Owner through
 * the team API: ownership moves only by transfer (F03). F03 moves this into
 * a `@nestjs/authorization` policy.
 */
const MANAGEABLE: Record<MemberRole, readonly MemberRole[]> = {
  OWNER: ['MANAGER', 'RECEPTIONIST', 'STAFF'],
  MANAGER: ['RECEPTIONIST', 'STAFF'],
  RECEPTIONIST: [],
  STAFF: [],
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  RECEPTIONIST: 'Receptionist',
  STAFF: 'Staff',
};

export function canManageRole(actor: MemberRole, target: MemberRole): boolean {
  return MANAGEABLE[actor].includes(target);
}

/** 403 unless `actor` may add, change or remove members with role `target`. */
export function assertCanManageRole(actor: MemberRole, target: MemberRole) {
  if (!canManageRole(actor, target)) {
    throw new DomainError(
      HttpStatus.FORBIDDEN,
      ErrorCode.Forbidden,
      `A ${ROLE_LABELS[actor]} cannot manage ${ROLE_LABELS[target]} members`,
    );
  }
}

export const ownershipTransferRequired = (message: string) =>
  new DomainError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.OwnershipTransferRequired,
    `${message}: ownership moves only by transfer`,
  );

/** The staff user, business and role resolved by `TenantGuard` for this request. */
export interface TenantActor {
  userId: string;
  tenantId: string;
  role: MemberRole;
}

export function tenantActor(): TenantActor {
  const actor = RequestContext.actor();
  if (actor?.kind !== 'staff' || !actor.tenantId || !actor.role) {
    throw new Error('No tenant actor in RequestContext: is TenantGuard on?');
  }
  return {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role as MemberRole,
  };
}
