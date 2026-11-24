import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { MemberRole, Prisma } from '../../generated/prisma/client.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../shared/database/prisma-errors.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AccountSetupService,
  type SetupLink,
} from '../auth/account-setup.service.js';
import { appLink } from '../auth/auth-links.js';
import { LINK_PATHS, SETUP_TOKEN_TTL_MS } from '../auth/auth.constants.js';
import { UsersRepository } from '../auth/repositories/users.repository.js';
import { EmailService } from '../email/email.service.js';
import {
  type MemberRow,
  MembershipsRepository,
} from '../tenancy/repositories/memberships.repository.js';
import { StaffRepository } from '../tenancy/repositories/staff.repository.js';
import { TenantsRepository } from '../tenancy/repositories/tenants.repository.js';
import { MemberInviteLimiter } from './member-invite-limiter.js';
import type {
  AddMemberDto,
  ListMembersQuery,
  UpdateMemberDto,
} from './team.schemas.js';
import {
  assertCanManageRole,
  ownershipTransferRequired,
  ROLE_LABELS,
  type TenantActor,
  tenantActor,
} from './team-roles.js';

type Tx = Prisma.TransactionClient;

export interface MemberView {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  /** Their calendar, if they have (or had) one. */
  staffId: string | null;
  /** Has an active calendar. */
  bookable: boolean;
  /** Setup status of the user, or REMOVED once removed from this business. */
  status: 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
  createdAt: Date;
}

export function toMemberView(row: MemberRow): MemberView {
  return {
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role,
    staffId: row.staffId,
    bookable: row.staff?.active ?? false,
    status: row.status === 'REMOVED' ? 'REMOVED' : row.user.status,
    createdAt: row.createdAt,
  };
}

/** What to email once the transaction has committed. */
type MemberEmail =
  { kind: 'welcome'; link: SetupLink } | { kind: 'added'; at: Date };

const staffMustBeBookable = () =>
  new DomainError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.StaffMustBeBookable,
    'A Staff member always has a bookable calendar',
  );

/**
 * Team members (F04): the Owner and Managers add Managers, Receptionists and
 * Staff, change their role, toggle their calendar and remove them. Runs
 * inside the business resolved by `TenantGuard` (RLS).
 *
 * New people get a `PENDING_SETUP` user and a set-password link (F02); a
 * user who already works elsewhere is just added. Emails go out after
 * commit.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly memberships: MembershipsRepository,
    private readonly staff: StaffRepository,
    private readonly tenants: TenantsRepository,
    private readonly users: UsersRepository,
    private readonly accountSetup: AccountSetupService,
    private readonly audit: AuditService,
    private readonly emails: EmailService,
    private readonly limiter: MemberInviteLimiter,
  ) {}

  /**
   * One transaction: User (if new) + Membership (+ calendar) + setup link +
   * audit. A removed member is re-added on their old membership.
   */
  async add(dto: AddMemberDto, addedBy: string): Promise<MemberView> {
    const actor = tenantActor();
    if (dto.role === 'OWNER') {
      throw ownershipTransferRequired('An Owner cannot be added');
    }
    assertCanManageRole(actor.role, dto.role);
    if (dto.role === 'STAFF' && dto.bookable === false) {
      throw staffMustBeBookable();
    }
    const bookable = dto.role === 'STAFF' || dto.bookable === true;
    await this.limiter.hit(actor.tenantId);

    let result: { member: MemberView; email: MemberEmail };
    try {
      result = await this.tenantPrisma.run(actor.tenantId, (tx) =>
        this.addInTx(tx, actor, dto, bookable),
      );
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.UniqueViolation)) {
        // A concurrent request added the same person first.
        throw new DomainError(
          HttpStatus.CONFLICT,
          ErrorCode.AlreadyMember,
          'This person was just added to the business',
        );
      }
      throw error;
    }

    await this.sendEmail(actor.tenantId, result.member, result.email, addedBy);
    return result.member;
  }

  async list(query: ListMembersQuery): Promise<MemberView[]> {
    const { tenantId } = tenantActor();
    const rows = await this.tenantPrisma.run(tenantId, (tx) =>
      this.memberships.list(tenantId, query, tx),
    );
    return rows.map(toMemberView);
  }

  /**
   * Changes the role (never to or from OWNER) and/or the calendar. Turning
   * `bookable` off deactivates the calendar; on reactivates or creates it.
   */
  async update(id: string, dto: UpdateMemberDto): Promise<MemberView> {
    const actor = tenantActor();
    return this.tenantPrisma.run(actor.tenantId, async (tx) => {
      const target = await this.findActive(actor.tenantId, id, tx);
      const role = dto.role ?? target.role;
      if (
        role !== target.role &&
        (role === 'OWNER' || target.role === 'OWNER')
      ) {
        throw ownershipTransferRequired('The Owner role cannot be changed');
      }
      this.assertCanActOn(actor, target);
      if (role !== target.role) assertCanManageRole(actor.role, role);

      const wasBookable = target.staff?.active ?? false;
      const becomesStaff = role === 'STAFF' && target.role !== 'STAFF';
      const bookable = dto.bookable ?? (becomesStaff || wasBookable);
      if (role === 'STAFF' && !bookable) throw staffMustBeBookable();

      let staffId = target.staffId;
      if (bookable && !wasBookable) {
        staffId = await this.activateCalendar(
          actor.tenantId,
          staffId,
          target.user.name,
          tx,
        );
      } else if (!bookable && wasBookable && staffId) {
        // F07: refuse with 409 STAFF_HAS_FUTURE_BOOKINGS once bookings exist.
        await this.staff.update(actor.tenantId, staffId, { active: false }, tx);
      }

      const updated = await this.memberships.update(
        actor.tenantId,
        id,
        { role, staffId },
        tx,
      );

      const before: Record<string, Prisma.InputJsonValue | null> = {};
      const after: Record<string, Prisma.InputJsonValue | null> = {};
      if (role !== target.role) {
        before.role = target.role;
        after.role = role;
      }
      if (bookable !== wasBookable) {
        before.bookable = wasBookable;
        after.bookable = bookable;
        after.staffId = staffId;
      }
      if (Object.keys(after).length > 0) {
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          action: 'membership.updated',
          entityType: 'membership',
          entityId: id,
          before,
          after,
        });
      }
      return toMemberView(updated);
    });
  }

  /**
   * Sets the membership REMOVED and deactivates their calendar. Their next
   * request to this business is a 403; the `User` and their other
   * businesses are untouched.
   */
  async remove(id: string): Promise<void> {
    const actor = tenantActor();
    await this.tenantPrisma.run(actor.tenantId, async (tx) => {
      const target = await this.findActive(actor.tenantId, id, tx);
      if (target.role === 'OWNER') {
        throw ownershipTransferRequired('The Owner cannot be removed');
      }
      assertCanManageRole(actor.role, target.role);

      if (target.staffId && target.staff?.active) {
        // F07: refuse with 409 STAFF_HAS_FUTURE_BOOKINGS once bookings exist.
        await this.staff.update(
          actor.tenantId,
          target.staffId,
          { active: false },
          tx,
        );
      }
      await this.memberships.remove(actor.tenantId, id, tx);
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        action: 'membership.removed',
        entityType: 'membership',
        entityId: id,
        before: { role: target.role, status: 'ACTIVE' },
        after: { status: 'REMOVED' },
      });
    });
  }

  /**
   * A new set-password link for a member who hasn't set up their account;
   * the previous link stops working. 409 once they have.
   */
  async resendSetup(id: string, addedBy: string): Promise<MemberView> {
    const actor = tenantActor();
    const { member, link } = await this.tenantPrisma.run(
      actor.tenantId,
      async (tx) => {
        const target = await this.findActive(actor.tenantId, id, tx);
        this.assertCanActOn(actor, target);
        if (target.user.status !== 'PENDING_SETUP') {
          throw new DomainError(
            HttpStatus.CONFLICT,
            ErrorCode.MemberAlreadyActive,
            'This member has already set up their account',
          );
        }
        await this.limiter.hit(actor.tenantId);
        const link = await this.accountSetup.createSetupLink(target.userId, tx);
        return { member: toMemberView(target), link };
      },
    );
    await this.sendEmail(
      actor.tenantId,
      member,
      { kind: 'welcome', link },
      addedBy,
    );
    return member;
  }

  private async addInTx(
    tx: Tx,
    actor: TenantActor,
    dto: AddMemberDto,
    bookable: boolean,
  ): Promise<{ member: MemberView; email: MemberEmail }> {
    const existing = await this.users.findByEmail(dto.email, tx);
    if (existing?.isPlatformAdmin) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.MemberIsPlatformAdmin,
        'A platform admin cannot join a business: use another email',
      );
    }
    if (existing?.status === 'DISABLED') {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.MemberDisabled,
        'This user is disabled and cannot be added',
      );
    }

    const user = existing ?? (await this.users.createPending(dto, tx));
    const previous = existing
      ? await this.memberships.findByUser(actor.tenantId, user.id, tx)
      : null;
    if (previous?.status === 'ACTIVE') {
      throw new DomainError(
        HttpStatus.CONFLICT,
        ErrorCode.AlreadyMember,
        'This person is already a member of this business',
      );
    }

    // The calendar is named as this business knows them (`dto.name`).
    const staffId = bookable
      ? await this.activateCalendar(
          actor.tenantId,
          previous?.staffId ?? null,
          dto.name,
          tx,
        )
      : (previous?.staffId ?? null);

    const row = previous
      ? await this.memberships.update(
          actor.tenantId,
          previous.id,
          {
            role: dto.role,
            staffId,
            status: 'ACTIVE',
            createdBy: actor.userId,
          },
          tx,
        )
      : await this.memberships.create(
          actor.tenantId,
          { userId: user.id, role: dto.role, staffId, createdBy: actor.userId },
          tx,
        );
    await this.audit.record(tx, {
      tenantId: actor.tenantId,
      action: 'membership.created',
      entityType: 'membership',
      entityId: row.id,
      after: { userId: user.id, role: dto.role, staffId },
      ...(previous && { reason: 'Removed member added again' }),
    });

    const member = toMemberView(row);
    // An existing user who never finished setup still needs a link.
    if (user.status === 'PENDING_SETUP') {
      const link = await this.accountSetup.createSetupLink(user.id, tx);
      return { member, email: { kind: 'welcome', link } };
    }
    return { member, email: { kind: 'added', at: new Date() } };
  }

  /** Reactivates the member's calendar, or creates one. Returns its id. */
  private async activateCalendar(
    tenantId: string,
    staffId: string | null,
    displayName: string,
    tx: Tx,
  ): Promise<string> {
    if (staffId) {
      await this.staff.update(tenantId, staffId, { active: true }, tx);
      return staffId;
    }
    const created = await this.staff.create(tenantId, { displayName }, tx);
    return created.id;
  }

  /** A member of this business who hasn't been removed; else 404. */
  private async findActive(
    tenantId: string,
    id: string,
    tx: Tx,
  ): Promise<MemberRow> {
    const row = await this.memberships.findById(tenantId, id, tx);
    if (!row || row.status !== 'ACTIVE') {
      throw new NotFoundException('Member not found');
    }
    return row;
  }

  /**
   * The Owner may act on their own membership (e.g. become bookable);
   * otherwise the role table decides.
   */
  private assertCanActOn(actor: TenantActor, target: MemberRow) {
    if (target.role === 'OWNER' && actor.role === 'OWNER') return;
    assertCanManageRole(actor.role, target.role);
  }

  /** Enqueued only after commit: a rolled-back add never emails anyone. */
  private async sendEmail(
    tenantId: string,
    member: MemberView,
    email: MemberEmail,
    addedBy: string,
  ) {
    const tenant = await this.tenants.findById(tenantId);
    const common = {
      name: member.name,
      businessName: tenant?.name ?? 'your business',
      roleLabel: ROLE_LABELS[member.role],
      addedBy,
    };
    if (email.kind === 'welcome') {
      await this.emails.enqueue(
        'member-welcome',
        member.email,
        {
          ...common,
          actionUrl: email.link.url,
          expiresInHours: SETUP_TOKEN_TTL_MS / 3_600_000,
        },
        // One email per link: a resend makes a new link, so a new job.
        {
          jobId: `member-welcome-${member.id}-${email.link.expiresAt.getTime()}`,
        },
      );
    } else {
      await this.emails.enqueue(
        'member-added',
        member.email,
        { ...common, actionUrl: appLink(LINK_PATHS.login, {}) },
        { jobId: `member-added-${member.id}-${email.at.getTime()}` },
      );
    }
  }
}
