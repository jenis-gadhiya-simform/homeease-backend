import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { AdminTenantsController } from './admin-tenants.controller.js';
import { PublicTenantsController } from './public-tenants.controller.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { StaffRepository } from './repositories/staff.repository.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
import { TenantResolver } from './tenant-resolver.js';
import { TenantOnboardingService } from './tenant-onboarding.service.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

/**
 * Tenancy & business onboarding (F01): businesses, the Owner membership,
 * `TenantResolver` (which business a request acts in, for F03) and the public profile.
 * Exports the resolver and repositories for tenant-scoped features.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [
    AdminTenantsController,
    TenantsController,
    PublicTenantsController,
  ],
  providers: [
    TenantsRepository,
    MembershipsRepository,
    StaffRepository,
    TenantResolver,
    TenantOnboardingService,
    TenantsService,
  ],
  exports: [
    TenantResolver,
    TenantsRepository,
    MembershipsRepository,
    StaffRepository,
  ],
})
export class TenancyModule {}
