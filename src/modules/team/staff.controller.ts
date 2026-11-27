import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TenantScoped } from '../tenancy/tenant-resolver.js';
import {
  ANY_MEMBER,
  Roles,
  UsePolicy,
} from '../authorization/authorization.decorators.js';
import { StaffPolicy } from '../authorization/policies/staff.policy.js';
import { StaffService } from './staff.service.js';
import {
  idParamSchema,
  type ListStaffQuery,
  listStaffQuerySchema,
  type UpdateStaffDto,
  updateStaffSchema,
} from './team.schemas.js';

const staffExample = {
  id: '0193…',
  displayName: 'Maya Rao',
  active: true,
  memberId: '0193…',
  userId: '0193…',
};

/** Bookable calendars of the current business (F04). */
@ApiTags('Staff')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'NOT_A_MEMBER, TENANT_SUSPENDED or FORBIDDEN',
})
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @TenantScoped()
  @Roles(...ANY_MEMBER)
  @ApiOperation({ summary: 'List calendars (any member)' })
  @ApiOkResponse({ schema: { example: { items: [staffExample] } } })
  async list(@Query({ schema: listStaffQuerySchema }) query: ListStaffQuery) {
    return { items: await this.staff.list(query) };
  }

  @Patch(':id')
  @TenantScoped()
  @UsePolicy(StaffPolicy, 'update')
  @ApiOperation({
    summary: 'Rename or (de)activate a calendar',
    description:
      'Owner, Manager: `displayName` and `active`. The staff member: their own `displayName` only.',
  })
  @ApiOkResponse({ schema: { example: staffExample } })
  update(
    @Param('id', { schema: idParamSchema }) id: string,
    @Body({ schema: updateStaffSchema }) body: UpdateStaffDto,
  ) {
    return this.staff.update(id, body);
  }
}
