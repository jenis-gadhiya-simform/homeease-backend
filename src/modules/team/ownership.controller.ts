import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UsePolicy } from '../authorization/authorization.decorators.js';
import { TenantPolicy } from '../authorization/policies/tenant.policy.js';
import { TenantScoped } from '../tenancy/tenant-resolver.js';
import { OwnershipService } from './ownership.service.js';
import {
  type TransferOwnershipDto,
  transferOwnershipSchema,
} from './team.schemas.js';

/** Ownership of the current business (F03). */
@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants/current')
export class OwnershipController {
  constructor(private readonly ownership: OwnershipService) {}

  @Post('transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @TenantScoped()
  @UsePolicy(TenantPolicy, 'transferOwnership')
  @ApiOperation({
    summary: 'Transfer ownership to a Manager',
    description:
      'Owner only, with their password re-entered. The Manager becomes Owner and the Owner becomes a Manager, in one transaction (audited).',
  })
  @ApiOkResponse({
    description: 'The new Owner and the previous Owner (now a Manager).',
  })
  @ApiForbiddenResponse({
    description:
      'FORBIDDEN (not the Owner) or REAUTHENTICATION_REQUIRED (wrong password)',
  })
  @ApiNotFoundResponse({ description: 'No active member with this id' })
  @ApiUnprocessableEntityResponse({
    description:
      'TRANSFER_TARGET_INVALID: not a Manager, yourself, or setup not finished',
  })
  @ApiConflictResponse({ description: 'Ownership changed concurrently' })
  transfer(
    @Body({ schema: transferOwnershipSchema }) body: TransferOwnershipDto,
  ) {
    return this.ownership.transfer(body);
  }
}
