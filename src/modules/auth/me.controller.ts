import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
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
  socialProviderSchema,
} from './auth.schemas.js';
import {
  type CustomerPrincipal,
  type Principal,
  SignInMethod,
} from './auth.types.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { UsersRepository } from './repositories/users.repository.js';
import { AccountKind } from '../../shared/context/request-context.js';
import { SocialSignInService } from './social/social-sign-in.service.js';
import type { SocialProvider } from './social/social-providers.js';

/** The signed-in account (staff or customer). */
@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly customerAuth: CustomerAuthService,
    private readonly authTokens: AuthTokensService,
    private readonly users: UsersRepository,
    private readonly social: SocialSignInService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The signed-in staff user or customer account',
    description:
      'A staff user also gets `memberships`: their role in each business they are an active member of (F04). A customer also gets `identities`: the Google / Microsoft accounts linked to it (F02 v2).',
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
    if (user.kind === AccountKind.CUSTOMER) {
      return { ...user, identities: await this.social.providerNames(user.id) };
    }
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

  @Get('identities')
  @CustomerOnly()
  @ApiOperation({ summary: 'Customer: linked Google / Microsoft accounts' })
  @ApiOkResponse({
    schema: {
      example: [
        {
          provider: 'google',
          email: 'asha@gmail.com',
          createdAt: '2026-11-24T10:00:00.000Z',
          lastUsedAt: '2026-11-24T10:00:00.000Z',
        },
      ],
    },
  })
  identities(@CurrentUser() account: CustomerPrincipal) {
    return this.social.list(account.id);
  }

  @Post('identities/:provider/link')
  @HttpCode(HttpStatus.OK)
  @CustomerOnly()
  @ApiOperation({
    summary: 'Customer: start linking Google / Microsoft',
    description:
      'Returns a one-time URL (5 minutes) for the browser to navigate to. It ends on `/account/sign-in-methods?linked=<provider>` or `?error=CODE` in the web app.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        url: 'http://localhost:3000/auth/customer/oidc/google/login?intent=…',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Provider not enabled' })
  link(
    @CurrentUser() account: CustomerPrincipal,
    @Param('provider', { schema: socialProviderSchema })
    provider: SocialProvider,
  ) {
    return this.social.createLinkIntent(account.id, provider);
  }

  @Delete('identities/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CustomerOnly()
  @ApiOperation({
    summary: 'Customer: disconnect Google / Microsoft',
    description:
      'Always allowed: an email link to the account address still signs the customer in.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Not connected' })
  async unlink(
    @CurrentUser() account: CustomerPrincipal,
    @Param('provider', { schema: socialProviderSchema })
    provider: SocialProvider,
  ) {
    await this.social.unlink(account.id, provider);
  }
}
