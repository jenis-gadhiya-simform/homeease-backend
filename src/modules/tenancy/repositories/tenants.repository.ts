import { Injectable } from '@nestjs/common';
import type { Prisma, TenantStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

export const tenantSelect = {
  id: true,
  slug: true,
  name: true,
  phone: true,
  city: true,
  address: true,
  status: true,
  createdAt: true,
} as const;

export type TenantView = Prisma.TenantGetPayload<{
  select: typeof tenantSelect;
}>;

/**
 * `tenant` rows. The tenant table is the root of tenancy (no tenant_id, no
 * RLS), so lookups here always name the tenant: by its id from the request
 * context, by slug for public pages, or from platform-admin code.
 */
@Injectable()
export class TenantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      slug: string;
      name: string;
      phone?: string;
      city?: string;
      address?: string;
    },
    db: Db,
  ): Promise<TenantView> {
    return db.tenant.create({ data, select: tenantSelect });
  }

  async findById(
    tenantId: string,
    db: Db = this.prisma,
  ): Promise<TenantView | null> {
    return db.tenant.findUnique({
      where: { id: tenantId },
      select: tenantSelect,
    });
  }

  async findBySlug(slug: string): Promise<TenantView | null> {
    return this.prisma.tenant.findUnique({
      where: { slug },
      select: tenantSelect,
    });
  }

  async update(
    tenantId: string,
    data: Prisma.TenantUpdateInput,
    db: Db,
  ): Promise<TenantView> {
    return db.tenant.update({
      where: { id: tenantId },
      data,
      select: tenantSelect,
    });
  }

  /** Newest first, keyset-paginated on the time-ordered UUIDv7 id. */
  async list(
    query: { status?: TenantStatus; cursor?: string; limit: number },
    db: Db,
  ): Promise<TenantView[]> {
    return db.tenant.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.cursor && { id: { lt: query.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit,
      select: tenantSelect,
    });
  }
}
