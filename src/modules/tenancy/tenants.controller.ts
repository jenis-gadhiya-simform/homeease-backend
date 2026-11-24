import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TenantScoped } from './tenant.guard.js';
import { TenantsService } from './tenants.service.js';
import { type UpdateTenantDto, updateTenantSchema } from './tenancy.schemas.js';

/** The business the signed-in staff user is acting in. */
@ApiTags('Tenants')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'NOT_A_MEMBER, TENANT_SUSPENDED or FORBIDDEN (role)',
})
@Controller('tenants/current')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @TenantScoped()
  @ApiOperation({ summary: 'Business profile (any member)' })
  current() {
    return this.tenants.current();
  }

  @Patch()
  @TenantScoped('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Update name, phone, city, address (Owner, Manager)',
    description:
      'No timezone, currency or locale: SlotWise is India-only and INR-only; times are UTC.',
  })
  update(@Body({ schema: updateTenantSchema }) body: UpdateTenantDto) {
    return this.tenants.updateCurrent(body);
  }
}
