import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { MemberRole, TenantStatus } from '../../generated/prisma/client.js';
import {
  AccountKind,
  RequestContext,
} from '../../shared/context/request-context.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import type { Principal } from '../auth/auth.types.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';

const TENANT_ROLES = 'tenancy:roles';
export const TENANT_HEADER = 'x-tenant-id';
const tenantIdSchema = z.uuid();

/**
 * Resolves the business a staff-side user is acting in (F01) and puts
 * `tenantId` + their role into `RequestContext`, where
 * `TenantPrismaService.runInCurrent()` and the audit log read them.
 *
 * - `X-Tenant-Id` picks one of the user's active memberships; without it, a
 *   user with exactly one membership uses that one.
 * - No matching membership → 403 `NOT_A_MEMBER`; several and no header →
 *   400 `TENANT_REQUIRED`; a suspended business → 403 `TENANT_SUSPENDED`.
 * - With `@TenantScoped(MemberRole.OWNER, MemberRole.MANAGER)`, other roles get 403 (RBAC until
 *   F03 brings `@nestjs/authorization`).
 *
 * Memberships are read from the database on every request, so removing one
 * takes effect immediately.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly memberships: MembershipsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const user = req.user;
    if (user?.kind !== AccountKind.STAFF) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.WrongAccountType,
        'This endpoint is for staff accounts',
      );
    }

    const requested = this.requestedTenant(req);
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

    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(
      TENANT_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (roles?.length && !roles.includes(membership.role)) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.Forbidden,
        'Your role in this business does not allow this',
      );
    }

    RequestContext.setActor({
      kind: AccountKind.STAFF,
      userId: user.id,
      role: membership.role,
      tenantId: membership.tenantId,
    });
    return true;
  }

  private requestedTenant(req: Request): string | undefined {
    const header = req.headers[TENANT_HEADER];
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
}

/**
 * The route acts inside one business (resolved by `TenantGuard`). Pass roles
 * to restrict it: `@TenantScoped(MemberRole.OWNER, MemberRole.MANAGER)`.
 */
export const TenantScoped = (...roles: MemberRole[]) =>
  applyDecorators(
    SetMetadata(TENANT_ROLES, roles),
    UseGuards(TenantGuard),
    ApiHeader({
      name: 'X-Tenant-Id',
      required: false,
      description:
        'Business to act in; required when the user belongs to several',
    }),
  );
