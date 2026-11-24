import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { RequestContext } from '../../shared/context/request-context.js';

export type AuditActorType =
  'USER' | 'CUSTOMER' | 'SYSTEM' | 'PLATFORM_ADMIN' | 'WEBHOOK';

export interface AuditEntry {
  /** Null for platform-level events. */
  tenantId: string | null;
  /** `tenant.created`, `membership.created`, … */
  action: string;
  entityType: string;
  entityId: string;
  /** Changed fields only, before and after. Never passwords or tokens. */
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
  reason?: string;
  /** Defaults to the request's actor (`SYSTEM` outside a request). */
  actorType?: AuditActorType;
}

/**
 * Writes the audit log in the caller's transaction (F09): if the insert
 * fails, the change rolls back with it. Actor, role, request id and IP come
 * from `RequestContext`. Pass a transaction that can write the entry's
 * tenant: `TenantPrismaService.run()` for tenant code, `AdminPrismaService`
 * for platform-admin code.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const store = RequestContext.current();
    const actor = store?.actor;
    const actorType: AuditActorType =
      entry.actorType ??
      (!actor
        ? 'SYSTEM'
        : actor.kind === 'customer'
          ? 'CUSTOMER'
          : actor.role === 'PLATFORM_ADMIN'
            ? 'PLATFORM_ADMIN'
            : 'USER');
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorType,
        actorId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        reason: entry.reason ?? null,
        requestId: store?.requestId ?? null,
        ip: store?.ip ?? null,
      },
      select: { id: true },
    });
  }
}
