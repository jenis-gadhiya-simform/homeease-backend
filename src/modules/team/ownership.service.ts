import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { MemberRole, MembershipStatus } from '../../generated/prisma/client.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../shared/database/prisma-errors.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersRepository } from '../auth/repositories/users.repository.js';
import { requireStaffSubject } from '../authorization/current-subject.js';
import { enforce } from '../authorization/decision.js';
import { TenantPolicy } from '../authorization/policies/tenant.policy.js';
import { MembershipsRepository } from '../tenancy/repositories/memberships.repository.js';
import { type MemberView, toMemberView } from './members.service.js';
import type { TransferOwnershipDto } from './team.schemas.js';

const ownershipChanged = () =>
  new DomainError(
    HttpStatus.CONFLICT,
    ErrorCode.Conflict,
    'Ownership changed while transferring it: reload and try again',
  );

/**
 * Ownership transfer (F03): the Owner hands the business to an active
 * Manager and becomes a Manager. Both role changes and the audit entry are
 * one transaction; each change applies only if the role is still what was
 * checked, so a concurrent transfer gets 409 instead of two Owners (the
 * one-Owner index is the last line of defence).
 */
@Injectable()
export class OwnershipService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly policy: TenantPolicy,
  ) {}

  async transfer(
    dto: TransferOwnershipDto,
  ): Promise<{ owner: MemberView; previousOwner: MemberView }> {
    const actor = requireStaffSubject();
    const hash = await this.users.findPasswordHash(actor.userId);
    const passwordConfirmed = await this.hasher.verify(
      dto.password,
      hash ?? undefined,
    );

    try {
      return await this.tenantPrisma.run(actor.tenantId, async (tx) => {
        const target = await this.memberships.findById(
          actor.tenantId,
          dto.memberId,
          tx,
        );
        if (!target || target.status !== MembershipStatus.ACTIVE) {
          throw new NotFoundException('Member not found');
        }
        enforce(
          this.policy.transferTo(
            actor,
            {
              userId: target.userId,
              role: target.role,
              userStatus: target.user.status,
            },
            passwordConfirmed,
          ),
        );

        const current = await this.memberships.findByUser(
          actor.tenantId,
          actor.userId,
          tx,
        );
        if (!current) throw ownershipChanged();
        // Demote first: the one-active-Owner index forbids two at once.
        const previousOwner = await this.memberships.changeRole(
          actor.tenantId,
          current.id,
          MemberRole.OWNER,
          MemberRole.MANAGER,
          tx,
        );
        if (!previousOwner) throw ownershipChanged();
        const owner = await this.memberships.changeRole(
          actor.tenantId,
          target.id,
          MemberRole.MANAGER,
          MemberRole.OWNER,
          tx,
        );
        if (!owner) throw ownershipChanged();

        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          action: 'tenant.ownership_transferred',
          entityType: 'tenant',
          entityId: actor.tenantId,
          before: { ownerUserId: actor.userId, ownerMemberId: current.id },
          after: { ownerUserId: target.userId, ownerMemberId: target.id },
        });
        return {
          owner: toMemberView(owner),
          previousOwner: toMemberView(previousOwner),
        };
      });
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.UniqueViolation)) {
        throw ownershipChanged();
      }
      throw error;
    }
  }
}
