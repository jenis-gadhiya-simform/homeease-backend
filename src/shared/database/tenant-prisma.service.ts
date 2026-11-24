import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { RequestContext } from '../context/request-context.js';
import { PrismaService } from './prisma.service.js';

export type TenantTx = Prisma.TransactionClient;

interface TxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeout?: number;
}

/**
 * Runs tenant-scoped work under PostgreSQL row-level security (F01).
 *
 * Each call opens a transaction and sets `app.tenant_id` (and/or
 * `app.user_id`) with `set_config(…, true)`: local to that transaction, so a
 * pooled connection never carries one request's tenant into the next. Every
 * query on a tenant table inside `fn` sees only that tenant's rows, even if
 * a `where` forgets `tenantId`. Outside these calls, tenant tables return
 * nothing to the app role.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  /** `fn` sees and writes only `tenantId`'s rows. */
  run<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
    options?: TxOptions,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, options);
  }

  /** Like `run()`, for the tenant resolved for this request by `TenantGuard`. */
  runInCurrent<T>(
    fn: (tx: TenantTx) => Promise<T>,
    options?: TxOptions,
  ): Promise<T> {
    const tenantId = RequestContext.actor()?.tenantId;
    if (!tenantId) {
      throw new Error(
        'No tenant in RequestContext: is the route behind TenantGuard?',
      );
    }
    return this.run(tenantId, fn, options);
  }

  /**
   * `fn` sees the user's own memberships across tenants (policy
   * `own_memberships`), and no other tenant data. For resolving which
   * business a user is acting in.
   */
  runAsUser<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }
}
