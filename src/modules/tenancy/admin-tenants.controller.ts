import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/platform-admin.guard.js';
import { TenantOnboardingService } from './tenant-onboarding.service.js';
import {
  type CreateTenantDto,
  createTenantSchema,
  type ListTenantsQuery,
  listTenantsQuerySchema,
  type OwnerDto,
  ownerSchema,
  tenantIdParamSchema,
} from './tenancy.schemas.js';

const tenantExample = {
  id: '0193…',
  slug: 'glow-salon',
  name: 'Glow Salon',
  phone: '+919876543210',
  city: 'Ahmedabad',
  address: null,
  status: 'ACTIVE',
  createdAt: '2026-11-22T08:00:00.000Z',
};

/** Platform admin: create businesses with their Owner, and manage pending Owners. */
@ApiTags('Admin: Tenants')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a platform admin' })
@PlatformAdminOnly()
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly onboarding: TenantOnboardingService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a business and its Owner',
    description:
      'One transaction. A new Owner gets a set-password email (72 h link); an existing staff user gets an "added as Owner" email.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        tenant: tenantExample,
        owner: {
          id: '0193…',
          email: 'owner@glow.example',
          name: 'Asha Patel',
          status: 'PENDING_SETUP',
        },
      },
    },
  })
  @ApiConflictResponse({ description: 'SLUG_TAKEN' })
  @ApiUnprocessableEntityResponse({
    description: 'OWNER_IS_PLATFORM_ADMIN or OWNER_DISABLED',
  })
  create(@Body({ schema: createTenantSchema }) body: CreateTenantDto) {
    return this.onboarding.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List businesses (newest first)' })
  @ApiOkResponse({
    schema: { example: { items: [tenantExample], nextCursor: null } },
  })
  list(@Query({ schema: listTenantsQuerySchema }) query: ListTenantsQuery) {
    return this.onboarding.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A business and its Owner' })
  detail(@Param('id', { schema: tenantIdParamSchema }) id: string) {
    return this.onboarding.detail(id);
  }

  @Post(':id/owner/resend-setup')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Email the pending Owner a new set-password link',
    description: 'The previous link stops working.',
  })
  @ApiConflictResponse({ description: 'OWNER_ALREADY_ACTIVE' })
  resendSetup(@Param('id', { schema: tenantIdParamSchema }) id: string) {
    return this.onboarding.resendOwnerSetup(id);
  }

  @Put(':id/owner')
  @ApiOperation({
    summary: 'Replace a pending Owner (e.g. wrong email typed)',
    description:
      'Only while the Owner has not set a password; afterwards use ownership transfer (F03).',
  })
  @ApiConflictResponse({ description: 'OWNER_ALREADY_ACTIVE' })
  replaceOwner(
    @Param('id', { schema: tenantIdParamSchema }) id: string,
    @Body({ schema: ownerSchema }) body: OwnerDto,
  ) {
    return this.onboarding.replacePendingOwner(id, body);
  }
}
