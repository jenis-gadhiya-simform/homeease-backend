import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  MemberRole,
  MembershipStatus,
  type Prisma,
  UserStatus,
} from '../../generated/prisma/client.js';
import { RequestContext } from '../../shared/context/request-context.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../shared/database/prisma-errors.js';
import { AdminPrismaService } from '../../shared/database/prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AccountSetupService,
  InviteEmailKind,
  type SetupLink,
} from '../auth/account-setup.service.js';
import { appLink } from '../auth/auth-links.js';
import { LINK_PATHS, SETUP_TOKEN_TTL_MS } from '../auth/auth.constants.js';
import { UsersRepository } from '../auth/repositories/users.repository.js';
import { EmailService } from '../email/email.service.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import {
  type TenantView,
  TenantsRepository,
} from './repositories/tenants.repository.js';
import type {
  CreateTenantDto,
  ListTenantsQuery,
  OwnerDto,
} from './tenancy.schemas.js';

type Tx = Prisma.TransactionClient;

export interface OwnerView {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
}

/** What to email once the transaction has committed. */
type OwnerEmail =
  | { kind: typeof InviteEmailKind.WELCOME; owner: OwnerView; link: SetupLink }
  | { kind: typeof InviteEmailKind.ADDED; owner: OwnerView };

/**
 * Platform-admin onboarding (F01): the admin creates a business together
 * with its Owner. Runs on `AdminPrismaService` (BYPASSRLS): a new tenant has
 * no RLS context yet, and the admin works across tenants.
 *
 * The admin never sets or sees the Owner's password: a new Owner gets a
 * single-use set-password link (F02 account setup), emailed after commit.
 */
@Injectable()
export class TenantOnboardingService {
  constructor(
    private readonly admin: AdminPrismaService,
    private readonly tenants: TenantsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    private readonly accountSetup: AccountSetupService,
    private readonly audit: AuditService,
    private readonly emails: EmailService,
  ) {}

  /**
   * One transaction: Tenant + User (if new, no password) + OWNER membership
   * + setup link + audit. A taken slug rolls everything back (409).
   */
  async create(dto: CreateTenantDto) {
    const { owner: ownerInput, ...business } = dto;
    let result: { tenant: TenantView; email: OwnerEmail };
    try {
      result = await this.admin.$transaction(async (tx) => {
        const tenant = await this.tenants.create(business, tx);
        await this.audit.record(tx, {
          tenantId: tenant.id,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { slug: tenant.slug, name: tenant.name },
        });
        const email = await this.addOwner(tx, tenant.id, ownerInput);
        return { tenant, email };
      });
    } catch (error) {
      if (
        isPrismaError(error, PrismaErrorCode.UniqueViolation) &&
        JSON.stringify(error.meta ?? {}).includes('slug')
      ) {
        throw new DomainError(
          HttpStatus.CONFLICT,
          ErrorCode.SlugTaken,
          `The slug "${dto.slug}" is already taken`,
        );
      }
      throw error;
    }

    await this.sendOwnerEmail(
      result.tenant,
      result.email,
      `owner-welcome-${result.tenant.id}`,
    );
    return { tenant: result.tenant, owner: result.email.owner };
  }

  async list(query: ListTenantsQuery) {
    const items = await this.tenants.list(query, this.admin);
    return {
      items,
      nextCursor:
        items.length === query.limit ? items[items.length - 1].id : null,
    };
  }

  async detail(tenantId: string) {
    return this.admin.$transaction(async (tx) => {
      const tenant = await this.findTenant(tenantId, tx);
      const owner = await this.memberships.findOwner(tenantId, tx);
      return { tenant, owner: owner?.user ?? null };
    });
  }

  /**
   * A new set-password link for an Owner who hasn't set up their account;
   * the previous link stops working. 409 once they have.
   */
  async resendOwnerSetup(tenantId: string) {
    const { tenant, owner, link } = await this.admin.$transaction(
      async (tx) => {
        const tenant = await this.findTenant(tenantId, tx);
        const owner = await this.pendingOwner(tenantId, tx);
        const link = await this.accountSetup.createSetupLink(owner.user.id, tx);
        return { tenant, owner: owner.user, link };
      },
    );
    await this.sendOwnerEmail(
      tenant,
      { kind: InviteEmailKind.WELCOME, owner, link },
      `owner-setup-${owner.id}-${link.expiresAt.getTime()}`,
    );
    return { owner };
  }

  /**
   * Replaces an Owner who hasn't set up their account yet (wrong email
   * typed). The old membership is removed and the old user's links revoked;
   * a pending user left with no business is disabled. Once the Owner is
   * active, ownership moves only by transfer (F03).
   */
  async replacePendingOwner(tenantId: string, dto: OwnerDto) {
    const { tenant, email } = await this.admin.$transaction(async (tx) => {
      const tenant = await this.findTenant(tenantId, tx);
      const current = await this.pendingOwner(tenantId, tx);
      if (current.user.email === dto.email) {
        throw new DomainError(
          HttpStatus.CONFLICT,
          ErrorCode.Conflict,
          'This person is already the Owner: use resend-setup for a new link',
        );
      }

      await this.memberships.remove(tenantId, current.id, tx);
      await this.audit.record(tx, {
        tenantId,
        action: 'membership.removed',
        entityType: 'membership',
        entityId: current.id,
        before: {
          userId: current.user.id,
          role: MemberRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
        after: { status: MembershipStatus.REMOVED },
        reason: 'Pending owner replaced',
      });
      await this.accountSetup.revokeLinks(current.user.id, tx);
      const elsewhere = await this.memberships.countOtherActiveForUser(
        tenantId,
        current.user.id,
        tx,
      );
      if (elsewhere === 0) {
        await this.users.setStatus(current.user.id, UserStatus.DISABLED, tx);
      }

      const email = await this.addOwner(tx, tenantId, dto);
      return { tenant, email };
    });
    await this.sendOwnerEmail(
      tenant,
      email,
      `owner-welcome-${tenantId}-${email.owner.id}`,
    );
    return { owner: email.owner };
  }

  /**
   * Finds or creates the Owner's user and adds the OWNER membership. A new
   * email gets a PENDING_SETUP user and a setup link; an existing staff user
   * (e.g. Owner of another business) just gets the membership.
   */
  private async addOwner(
    tx: Tx,
    tenantId: string,
    input: OwnerDto,
  ): Promise<OwnerEmail> {
    const existing = await this.users.findByEmail(input.email, tx);
    if (existing?.isPlatformAdmin) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.OwnerIsPlatformAdmin,
        'A platform admin cannot own a business: use another email',
      );
    }
    if (existing?.status === UserStatus.DISABLED) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.OwnerDisabled,
        'This user is disabled and cannot be made Owner',
      );
    }

    const user = existing ?? (await this.users.createPending(input, tx));
    const membership = await this.memberships.create(
      tenantId,
      {
        userId: user.id,
        role: MemberRole.OWNER,
        createdBy: RequestContext.actor()?.userId ?? null,
      },
      tx,
    );
    await this.audit.record(tx, {
      tenantId,
      action: 'membership.created',
      entityType: 'membership',
      entityId: membership.id,
      after: { userId: user.id, role: MemberRole.OWNER },
    });

    const owner: OwnerView = {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    };
    // An existing user who never finished setup keeps needing a link.
    if (!existing || existing.status === UserStatus.PENDING_SETUP) {
      const link = await this.accountSetup.createSetupLink(user.id, tx);
      return { kind: InviteEmailKind.WELCOME, owner, link };
    }
    return { kind: InviteEmailKind.ADDED, owner };
  }

  /** Enqueued only after commit: a rolled-back business never emails anyone. */
  private async sendOwnerEmail(
    tenant: TenantView,
    email: OwnerEmail,
    jobId: string,
  ) {
    if (email.kind === InviteEmailKind.WELCOME) {
      await this.emails.enqueue(
        'owner-welcome',
        email.owner.email,
        {
          name: email.owner.name,
          businessName: tenant.name,
          actionUrl: email.link.url,
          expiresInHours: SETUP_TOKEN_TTL_MS / 3_600_000,
        },
        { jobId },
      );
    } else {
      await this.emails.enqueue(
        'owner-added',
        email.owner.email,
        {
          name: email.owner.name,
          businessName: tenant.name,
          actionUrl: appLink(LINK_PATHS.login, {}),
        },
        { jobId },
      );
    }
  }

  private async findTenant(tenantId: string, tx: Tx): Promise<TenantView> {
    const tenant = await this.tenants.findById(tenantId, tx);
    if (!tenant) throw new NotFoundException('Business not found');
    return tenant;
  }

  private async pendingOwner(tenantId: string, tx: Tx) {
    const owner = await this.memberships.findOwner(tenantId, tx);
    if (!owner) throw new NotFoundException('This business has no Owner');
    if (owner.user.status !== UserStatus.PENDING_SETUP) {
      throw new DomainError(
        HttpStatus.CONFLICT,
        ErrorCode.OwnerAlreadyActive,
        'The Owner has already set up their account',
      );
    }
    return owner;
  }
}
