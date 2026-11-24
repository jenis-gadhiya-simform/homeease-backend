import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  CurrentSession,
  CurrentUser,
  type JwtClaims,
} from '@nestjs/authentication';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CustomerOnly } from './account-kind.guard.js';
import { AuthTokensService } from './auth-tokens.service.js';
import {
  type ChangeCustomerPasswordDto,
  changeCustomerPasswordSchema,
} from './auth.schemas.js';
import {
  type CustomerPrincipal,
  type Principal,
  SignInMethod,
} from './auth.types.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { UsersRepository } from './repositories/users.repository.js';
import { AccountKind } from '../../shared/context/request-context.js';

/** The signed-in account (staff or customer). */
@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly customerAuth: CustomerAuthService,
    private readonly authTokens: AuthTokensService,
    private readonly users: UsersRepository,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The signed-in staff user or customer account',
    description:
      'A staff user also gets `memberships`: their role in each business they are an active member of (F04).',
  })
  @ApiOkResponse({
    schema: {
      example: {
        kind: 'staff',
        id: '0193…',
        email: 'maya@glow.example',
        name: 'Maya Rao',
        isPlatformAdmin: false,
        memberships: [
          {
            tenantId: '0193…',
            tenantName: 'Glow Salon',
            tenantSlug: 'glow-salon',
            tenantStatus: 'ACTIVE',
            role: 'STAFF',
            staffId: '0193…',
          },
        ],
      },
    },
  })
  async me(@CurrentUser() user: Principal) {
    if (user.kind !== AccountKind.STAFF) return user;
    return { ...user, memberships: await this.users.findMemberships(user.id) };
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @CustomerOnly()
  @ApiOperation({
    summary: 'Customer: set or change the password',
    description:
      'Needs `currentPassword` when one is set; otherwise a magic-link sign-in from the last 15 minutes. Signs out other devices and returns fresh tokens.',
  })
  @ApiForbiddenResponse({
    description: 'REAUTHENTICATION_REQUIRED or WRONG_ACCOUNT_TYPE',
  })
  async changePassword(
    @CurrentUser() account: CustomerPrincipal,
    @CurrentSession() session: JwtClaims | null,
    @Body({ schema: changeCustomerPasswordSchema })
    body: ChangeCustomerPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const updated = await this.customerAuth.changePassword(
      account,
      session,
      body.currentPassword,
      body.newPassword,
    );
    await this.authTokens.signOutEverywhere(updated.id);
    return this.authTokens.signIn(updated, SignInMethod.PASSWORD, res);
  }
}
