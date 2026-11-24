import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export const staffSelect = {
  id: true,
  displayName: true,
  active: true,
  membership: { select: { id: true, userId: true, status: true } },
} as const;

export type StaffRow = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

/**
 * `staff` rows: bookable calendars (F04, a tenant table: RLS applies). Every
 * method takes `tenantId` first and filters by it; run them inside
 * `TenantPrismaService.run()`.
 */
@Injectable()
export class StaffRepository {
  async create(tenantId: string, data: { displayName: string }, tx: Tx) {
    return tx.staff.create({
      data: { tenantId, displayName: data.displayName },
      select: { id: true },
    });
  }

  async findById(
    tenantId: string,
    staffId: string,
    tx: Tx,
  ): Promise<StaffRow | null> {
    return tx.staff.findFirst({
      where: { id: staffId, tenantId },
      select: staffSelect,
    });
  }

  /** Oldest first (UUIDv7 ids are time-ordered). */
  async list(
    tenantId: string,
    filter: { active?: boolean },
    tx: Tx,
  ): Promise<StaffRow[]> {
    return tx.staff.findMany({
      where: {
        tenantId,
        ...(filter.active !== undefined && { active: filter.active }),
      },
      orderBy: { id: 'asc' },
      select: staffSelect,
    });
  }

  /** Active calendars for the public booking page. */
  async listPublic(tenantId: string, tx: Tx) {
    return tx.staff.findMany({
      where: { tenantId, active: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    });
  }

  async update(
    tenantId: string,
    staffId: string,
    data: { displayName?: string; active?: boolean },
    tx: Tx,
  ): Promise<StaffRow> {
    return tx.staff.update({
      where: { id: staffId, tenantId },
      data,
      select: staffSelect,
    });
  }
}
