import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { MemberInviteLimiter } from './member-invite-limiter.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { OwnershipController } from './ownership.controller.js';
import { OwnershipService } from './ownership.service.js';
import { MemberPolicy } from '../authorization/policies/member.policy.js';
import { StaffPolicy } from '../authorization/policies/staff.policy.js';
import { TenantPolicy } from '../authorization/policies/tenant.policy.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

/**
 * Team members & staff (F04): the Owner and Managers build the team
 * (`/members`), and bookable calendars (`/staff`) are kept apart from
 * logins. Ownership transfer (F03) lives here too: it changes memberships.
 */
@Module({
  imports: [AuthModule, EmailModule, TenancyModule],
  controllers: [MembersController, StaffController, OwnershipController],
  providers: [
    MembersService,
    StaffService,
    OwnershipService,
    MemberInviteLimiter,
    MemberPolicy,
    StaffPolicy,
    TenantPolicy,
  ],
})
export class TeamModule {}
