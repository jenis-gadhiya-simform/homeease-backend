import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../shared/context/request-context.js';
import { TenantPrismaService } from '../../shared/database/tenant-prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StaffRepository } from './repositories/staff.repository.js';
import {
  type TenantView,
  TenantsRepository,
} from './repositories/tenants.repository.js';
import type { UpdateTenantDto } from './tenancy.schemas.js';

/** The business profile, for its members and the public booking page. */
@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantsRepository,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
  ) {}

  /** The business resolved by `TenantGuard` for this request. */
  async current(): Promise<TenantView> {
    const tenant = await this.tenants.findById(this.currentTenantId());
    if (!tenant) throw new NotFoundException('Business not found');
    return tenant;
  }

  /** Updates name / phone / city / address and audits the changed fields. */
  async updateCurrent(dto: UpdateTenantDto): Promise<TenantView> {
    const tenantId = this.currentTenantId();
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await this.tenants.findById(tenantId, tx);
      if (!before) throw new NotFoundException('Business not found');
      const updated = await this.tenants.update(tenantId, dto, tx);

      const changed = (Object.keys(dto) as (keyof UpdateTenantDto)[]).filter(
        (key) => before[key] !== updated[key],
      );
      if (changed.length > 0) {
        await this.audit.record(tx, {
          tenantId,
          action: 'tenant.updated',
          entityType: 'tenant',
          entityId: tenantId,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, updated[k]])),
        });
      }
      return updated;
    });
  }

  /**
   * The public profile behind `/public/:slug`. A suspended or unknown
   * business is the same 404. Lists the active staff calendars (F04); a
   * deactivated one disappears at once. Services are added by F05.
   */
  async publicProfile(slug: string) {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Business not found');
    }
    const staff = await this.tenantPrisma.run(tenant.id, (tx) =>
      this.staff.listPublic(tenant.id, tx),
    );
    return {
      slug: tenant.slug,
      name: tenant.name,
      phone: tenant.phone,
      city: tenant.city,
      address: tenant.address,
      staff,
    };
  }

  private currentTenantId(): string {
    const tenantId = RequestContext.actor()?.tenantId;
    if (!tenantId) throw new Error('No tenant in RequestContext');
    return tenantId;
  }
}
