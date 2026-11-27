import { Injectable } from '@nestjs/common';
import {
  MemberRole,
  MembershipStatus,
  type Prisma,
  UserStatus,
} from '../../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

const ownerSelect = {
  id: true,
  user: { select: { id: true, email: true, name: true, status: true } },
} as const;

/** A member as the team API shows it (F04). */
export const memberSelect = {
  id: true,
  userId: true,
  role: true,
  status: true,
  staffId: true,
  createdAt: true,
  user: { select: { email: true, name: true, status: true } },
  staff: { select: { active: true, displayName: true } },
} as const;

export type MemberRow = Prisma.MembershipGetPayload<{
  select: typeof memberSelect;
}>;

/**
 * Status filter of the member list (F04): `ACTIVE` / `PENDING_SETUP` are the
 * user's setup status, `REMOVED` the membership's.
 */
export const MemberListStatus = {
  ACTIVE: UserStatus.ACTIVE,
  PENDING_SETUP: UserStatus.PENDING_SETUP,
  REMOVED: MembershipStatus.REMOVED,
} as const;
export type MemberListStatus =
  (typeof MemberListStatus)[keyof typeof MemberListStatus];

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
    data: {
      userId: string;
      role: MemberRole;
      createdBy: string | null;
      staffId?: string | null;
    },
    tx: Tx,
  ): Promise<MemberRow> {
    return tx.membership.create({
      data: { tenantId, ...data },
      select: memberSelect,
    });
  }

  /** The active Owner and their user, or null. */
  async findOwner(tenantId: string, tx: Tx) {
    return tx.membership.findFirst({
      where: {
        tenantId,
        role: MemberRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
      select: ownerSelect,
    });
  }

  async findById(
    tenantId: string,
    membershipId: string,
    tx: Tx,
  ): Promise<MemberRow | null> {
    return tx.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: memberSelect,
    });
  }

  /** The user's membership in this business (active or removed), or null. */
  async findByUser(
    tenantId: string,
    userId: string,
    tx: Tx,
  ): Promise<MemberRow | null> {
    return tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: memberSelect,
    });
  }

  /** Oldest first. Without `status`, removed members are left out. */
  async list(
    tenantId: string,
    filter: { role?: MemberRole; status?: MemberListStatus },
    tx: Tx,
  ): Promise<MemberRow[]> {
    const status: MembershipStatus =
      filter.status === MemberListStatus.REMOVED
        ? MembershipStatus.REMOVED
        : MembershipStatus.ACTIVE;
    const userStatus: UserStatus | undefined =
      filter.status === MemberListStatus.REMOVED ? undefined : filter.status;
    return tx.membership.findMany({
      where: {
        tenantId,
        status,
        ...(filter.role && { role: filter.role }),
        ...(userStatus && { user: { status: userStatus } }),
      },
      orderBy: { id: 'asc' },
      select: memberSelect,
    });
  }

  /** Role, calendar or status (re-adding a removed member sets it ACTIVE). */
  async update(
    tenantId: string,
    membershipId: string,
    data: {
      role?: MemberRole;
      staffId?: string | null;
      status?: MembershipStatus;
      createdBy?: string | null;
    },
    tx: Tx,
  ): Promise<MemberRow> {
    return tx.membership.update({
      where: { id: membershipId, tenantId },
      data,
      select: memberSelect,
    });
  }

  /**
   * Changes an ACTIVE membership's role only if it still has role `from`.
   * Returns the updated member, or null when it changed in the meantime.
   */
  async changeRole(
    tenantId: string,
    membershipId: string,
    from: MemberRole,
    to: MemberRole,
    tx: Tx,
  ): Promise<MemberRow | null> {
    const { count } = await tx.membership.updateMany({
      where: {
        id: membershipId,
        tenantId,
        role: from,
        status: MembershipStatus.ACTIVE,
      },
      data: { role: to },
    });
    return count === 1 ? this.findById(tenantId, membershipId, tx) : null;
  }

  async remove(tenantId: string, membershipId: string, tx: Tx) {
    await tx.membership.update({
      where: { id: membershipId, tenantId },
      data: { status: MembershipStatus.REMOVED },
      select: { id: true },
    });
  }

  /** Active memberships of a user in any other business than `tenantId`. */
  async countOtherActiveForUser(tenantId: string, userId: string, tx: Tx) {
    return tx.membership.count({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        tenantId: { not: tenantId },
      },
    });
  }

  /**
   * The user's active memberships across businesses, with each business's
   * status. Run under `TenantPrismaService.runAsUser()` (policy
   * `own_memberships`).
   */
  async findActiveForUser(userId: string, tx: Tx) {
    return tx.membership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      select: {
        tenantId: true,
        role: true,
        staffId: true,
        tenant: { select: { status: true } },
      },
    });
  }
}
