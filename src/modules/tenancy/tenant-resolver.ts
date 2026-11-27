import {
  applyDecorators,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { TenantStatus } from '../../generated/prisma/client.js';
import { AccountKind } from '../../shared/context/request-context.js';
import {
  type StaffSubject,
  SubjectKind,
} from '../../shared/context/subject.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import type { Principal } from '../auth/auth.types.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';

/** Set by `@TenantScoped()`; read by the subject resolver (F03). */
export const TENANT_SCOPED = 'tenancy:scoped';
export const TENANT_HEADER = 'x-tenant-id';
const tenantIdSchema = z.uuid();

/**
 * Resolves the business a staff-side user is acting in (F01) and their
 * membership there, for the authorization subject (F03).
 *
 * - `X-Tenant-Id` picks one of the user's active memberships; without it, a
 *   user with exactly one membership uses that one.
 * - A customer → 403 `WRONG_ACCOUNT_TYPE`; no matching membership → 403
 *   `NOT_A_MEMBER`; several and no header → 400 `TENANT_REQUIRED`; a
 *   suspended business → 403 `TENANT_SUSPENDED` (rule A12, reads included).
 *
 * Memberships are read from the database on every request, so removing one
 * takes effect immediately.
 */
@Injectable()
export class TenantResolver {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly memberships: MembershipsRepository,
  ) {}

  async resolve(
    user: Principal | null | undefined,
    headers: IncomingHttpHeaders,
  ): Promise<StaffSubject> {
    if (user?.kind !== AccountKind.STAFF) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.WrongAccountType,
        'This endpoint is for staff accounts',
      );
    }

    const requested = requestedTenant(headers);
    const memberships = await this.tenantPrisma.runAsUser(user.id, (tx) =>
      this.memberships.findActiveForUser(user.id, tx),
    );
    const membership = requested
      ? memberships.find((m) => m.tenantId === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (!membership) {
      if (!requested && memberships.length > 1) {
        throw new DomainError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.TenantRequired,
          'You belong to several businesses: send the X-Tenant-Id header',
        );
      }
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.NotAMember,
        'You are not a member of this business',
      );
    }
    if (membership.tenant.status === TenantStatus.SUSPENDED) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.TenantSuspended,
        'This business is suspended',
      );
    }

    return {
      kind: SubjectKind.STAFF,
      userId: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      staffId: membership.staffId,
    };
  }
}

function requestedTenant(headers: IncomingHttpHeaders): string | undefined {
  const header = headers[TENANT_HEADER];
  if (header === undefined) return undefined;
  const parsed = tenantIdSchema.safeParse(header);
  if (!parsed.success) {
    throw new DomainError(
      HttpStatus.BAD_REQUEST,
      ErrorCode.BadRequest,
      'X-Tenant-Id must be a business id (UUID)',
    );
  }
  return parsed.data;
}

/**
 * The route acts inside one business: the subject is the caller's
 * membership there (role, calendar). Who may call it is declared next to it
 * with `@Roles(...)` or `@UsePolicy(...)` (F03).
 */
export const TenantScoped = () =>
  applyDecorators(
    SetMetadata(TENANT_SCOPED, true),
    ApiHeader({
      name: 'X-Tenant-Id',
      required: false,
      description:
        'Business to act in; required when the user belongs to several',
    }),
  );
