import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { StaffPrincipal } from '../auth/auth.types.js';
import { TenantScoped } from '../tenancy/tenant.guard.js';
import { MembersService } from './members.service.js';
import {
  type AddMemberDto,
  addMemberSchema,
  idParamSchema,
  type ListMembersQuery,
  listMembersQuerySchema,
  type UpdateMemberDto,
  updateMemberSchema,
} from './team.schemas.js';

const memberExample = {
  id: '0193…',
  userId: '0193…',
  email: 'maya@glow.example',
  name: 'Maya Rao',
  role: 'STAFF',
  staffId: '0193…',
  bookable: true,
  status: 'PENDING_SETUP',
  createdAt: '2026-11-24T10:00:00.000Z',
};

/**
 * The team of the current business (F04). Owner and Manager only; who can
 * add, change or remove whom follows the role table (Owner: Manager,
 * Receptionist, Staff; Manager: Receptionist, Staff).
 */
@ApiTags('Members')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'NOT_A_MEMBER, TENANT_SUSPENDED or FORBIDDEN (role)',
})
@TenantScoped('OWNER', 'MANAGER')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Post()
  @ApiOperation({
    summary: 'Add a member',
    description:
      'A new email gets a set-password email (72 h link); a user who already works at another business gets an "added" email. STAFF always get a calendar; other roles with `bookable: true`.',
  })
  @ApiCreatedResponse({ schema: { example: { member: memberExample } } })
  @ApiConflictResponse({ description: 'ALREADY_MEMBER' })
  @ApiUnprocessableEntityResponse({
    description:
      'OWNERSHIP_TRANSFER_REQUIRED, MEMBER_IS_PLATFORM_ADMIN, MEMBER_DISABLED or STAFF_MUST_BE_BOOKABLE',
  })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED: MEMBER_INVITE_LIMIT invitations per hour',
  })
  async add(
    @Body({ schema: addMemberSchema }) body: AddMemberDto,
    @CurrentUser() user: StaffPrincipal,
  ) {
    return { member: await this.members.add(body, user.name) };
  }

  @Get()
  @ApiOperation({
    summary: 'List members',
    description:
      '`status`: ACTIVE or PENDING_SETUP (setup status), REMOVED. Without it, every member not removed.',
  })
  @ApiOkResponse({ schema: { example: { items: [memberExample] } } })
  async list(
    @Query({ schema: listMembersQuerySchema }) query: ListMembersQuery,
  ) {
    return { items: await this.members.list(query) };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change role and/or bookable',
    description:
      'Never to or from OWNER (ownership transfer, F03). `bookable: false` deactivates the calendar.',
  })
  @ApiOkResponse({ schema: { example: { member: memberExample } } })
  @ApiUnprocessableEntityResponse({
    description: 'OWNERSHIP_TRANSFER_REQUIRED or STAFF_MUST_BE_BOOKABLE',
  })
  async update(
    @Param('id', { schema: idParamSchema }) id: string,
    @Body({ schema: updateMemberSchema }) body: UpdateMemberDto,
  ) {
    return { member: await this.members.update(id, body) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member',
    description:
      'Their access to this business ends on their next request and their calendar is deactivated. The user and their other businesses are untouched.',
  })
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({
    description: 'OWNERSHIP_TRANSFER_REQUIRED (the Owner)',
  })
  async remove(@Param('id', { schema: idParamSchema }) id: string) {
    await this.members.remove(id);
  }

  @Post(':id/resend-setup')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Email a pending member a new set-password link',
    description: 'The previous link stops working.',
  })
  @ApiConflictResponse({ description: 'MEMBER_ALREADY_ACTIVE' })
  @ApiTooManyRequestsResponse({ description: 'RATE_LIMITED' })
  async resendSetup(
    @Param('id', { schema: idParamSchema }) id: string,
    @CurrentUser() user: StaffPrincipal,
  ) {
    return { member: await this.members.resendSetup(id, user.name) };
  }
}
