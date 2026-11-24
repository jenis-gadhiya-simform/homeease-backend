import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { MemberInviteLimiter } from './member-invite-limiter.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

/**
 * Team members & staff (F04): the Owner and Managers build the team
 * (`/members`), and bookable calendars (`/staff`) are kept apart from
 * logins.
 */
@Module({
  imports: [AuthModule, EmailModule, TenancyModule],
  controllers: [MembersController, StaffController],
  providers: [MembersService, StaffService, MemberInviteLimiter],
})
export class TeamModule {}
