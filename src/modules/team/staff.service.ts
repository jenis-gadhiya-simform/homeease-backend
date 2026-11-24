import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  MemberRole,
  MembershipStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AuditService } from '../audit/audit.service.js';
import {
  type StaffRow,
  StaffRepository,
} from '../tenancy/repositories/staff.repository.js';
import type { ListStaffQuery, UpdateStaffDto } from './team.schemas.js';
import { tenantActor } from './team-roles.js';

export interface StaffView {
  id: string;
  displayName: string;
  active: boolean;
  /** The member this calendar belongs to. */
  memberId: string | null;
  userId: string | null;
}

function toStaffView(row: StaffRow): StaffView {
  return {
    id: row.id,
    displayName: row.displayName,
    active: row.active,
    memberId: row.membership?.id ?? null,
    userId: row.membership?.userId ?? null,
  };
}

/** Bookable calendars (F04). */
@Injectable()
export class StaffService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListStaffQuery): Promise<StaffView[]> {
    const { tenantId } = tenantActor();
    const rows = await this.tenantPrisma.run(tenantId, (tx) =>
      this.staff.list(tenantId, { active: query.active }, tx),
    );
    return rows.map(toStaffView);
  }

  /**
   * Owner and Manager: display name and `active` of any calendar. A member
   * may rename their own calendar, nothing else. Deactivating hides it from
   * the public page at once.
   */
  async update(id: string, dto: UpdateStaffDto): Promise<StaffView> {
    const actor = tenantActor();
    return this.tenantPrisma.run(actor.tenantId, async (tx) => {
      const current = await this.staff.findById(actor.tenantId, id, tx);
      if (!current) throw new NotFoundException('Staff not found');

      const manager =
        actor.role === MemberRole.OWNER || actor.role === MemberRole.MANAGER;
      const own = current.membership?.userId === actor.userId;
      if (!manager && !(own && dto.active === undefined)) {
        throw new DomainError(
          HttpStatus.FORBIDDEN,
          ErrorCode.Forbidden,
          own
            ? 'Only an Owner or Manager can activate or deactivate a calendar'
            : 'You can only change your own calendar',
        );
      }
      if (
        dto.active === true &&
        current.membership?.status !== MembershipStatus.ACTIVE
      ) {
        throw new DomainError(
          HttpStatus.CONFLICT,
          ErrorCode.Conflict,
          'This calendar belongs to a removed member: add them again instead',
        );
      }
      // F07: deactivating refuses with 409 STAFF_HAS_FUTURE_BOOKINGS; F16
      // invalidates the availability cache.

      const updated = await this.staff.update(actor.tenantId, id, dto, tx);
      const changed = (Object.keys(dto) as (keyof UpdateStaffDto)[]).filter(
        (key) => current[key] !== updated[key],
      );
      if (changed.length > 0) {
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          action: 'staff.updated',
          entityType: 'staff',
          entityId: id,
          before: Object.fromEntries(
            changed.map((k) => [k, current[k]]),
          ) as Prisma.InputJsonObject,
          after: Object.fromEntries(
            changed.map((k) => [k, updated[k]]),
          ) as Prisma.InputJsonObject,
        });
      }
      return toStaffView(updated);
    });
  }
}
