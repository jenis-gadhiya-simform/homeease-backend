import { Injectable } from '@nestjs/common';
import type { MemberRole, Prisma } from '../../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

const ownerSelect = {
  id: true,
  user: { select: { id: true, email: true, name: true, status: true } },
} as const;

/**
 * `membership` rows (a tenant table: RLS applies). Every method that reads
 * or writes one tenant's memberships takes `tenantId` first and filters by
 * it, in addition to the policy; run them inside
 * `TenantPrismaService.run()` (or an admin transaction).
 */
@Injectable()
export class MembershipsRepository {
  async create(
    tenantId: string,
    data: { userId: string; role: MemberRole; createdBy: string | null },
    tx: Tx,
  ) {
    return tx.membership.create({
      data: { tenantId, ...data },
      select: { id: true, userId: true, role: true, status: true },
    });
  }

  /** The active Owner and their user, or null. */
  async findOwner(tenantId: string, tx: Tx) {
    return tx.membership.findFirst({
      where: { tenantId, role: 'OWNER', status: 'ACTIVE' },
      select: ownerSelect,
    });
  }

  async remove(tenantId: string, membershipId: string, tx: Tx) {
    await tx.membership.update({
      where: { id: membershipId, tenantId },
      data: { status: 'REMOVED' },
      select: { id: true },
    });
  }

  /** Active memberships of a user in any other business than `tenantId`. */
  async countOtherActiveForUser(tenantId: string, userId: string, tx: Tx) {
    return tx.membership.count({
      where: { userId, status: 'ACTIVE', tenantId: { not: tenantId } },
    });
  }

  /**
   * The user's active memberships across businesses, with each business's
   * status. Run under `TenantPrismaService.runAsUser()` (policy
   * `own_memberships`).
   */
  async findActiveForUser(userId: string, tx: Tx) {
    return tx.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        tenantId: true,
        role: true,
        tenant: { select: { status: true } },
      },
    });
  }
}
