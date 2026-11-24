import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { TenantsService } from './tenants.service.js';

const slugParamSchema = z.string().regex(/^[a-z0-9-]{3,40}$/);

/** Public booking pages: no sign-in, the business comes from the URL. */
@ApiTags('Public')
@Public()
@Controller('public')
export class PublicTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Public business profile' })
  @ApiOkResponse({
    schema: {
      example: {
        slug: 'glow-salon',
        name: 'Glow Salon',
        phone: '+919876543210',
        city: 'Ahmedabad',
        address: null,
        staff: [{ id: '0193…', displayName: 'Maya Rao' }],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Unknown or suspended business' })
  profile(@Param('slug', { schema: slugParamSchema }) slug: string) {
    return this.tenants.publicProfile(slug);
  }
}
