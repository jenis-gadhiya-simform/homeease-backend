import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { AdminTenantsController } from './admin-tenants.controller.js';
import { PublicTenantsController } from './public-tenants.controller.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { StaffRepository } from './repositories/staff.repository.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
import { TenantGuard } from './tenant.guard.js';
import { TenantOnboardingService } from './tenant-onboarding.service.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

/**
 * Tenancy & business onboarding (F01): businesses, the Owner membership,
 * `TenantGuard` (which business a request acts in) and the public profile.
 * Exports the guard and repositories for tenant-scoped features.
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
    TenantGuard,
    TenantOnboardingService,
    TenantsService,
  ],
  exports: [
    TenantGuard,
    TenantsRepository,
    MembershipsRepository,
    StaffRepository,
  ],
})
export class TenancyModule {}
