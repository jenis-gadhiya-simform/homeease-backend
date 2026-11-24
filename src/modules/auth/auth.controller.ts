import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import {
  ApiAcceptedResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AccountSetupService } from './account-setup.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import {
  accountSetupTokenParamSchema,
  type CompleteAccountSetupDto,
  completeAccountSetupSchema,
  type ForgotPasswordDto,
  forgotPasswordSchema,
  type LoginDto,
  loginSchema,
  type MagicLinkRequestDto,
  magicLinkRequestSchema,
  type MagicLinkVerifyDto,
  magicLinkVerifySchema,
  type ResetPasswordDto,
  resetPasswordSchema,
} from './auth.schemas.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SignInService } from './sign-in.service.js';
import { SignInMethod } from './auth.types.js';

/** Per client IP; the per-email limit is `AuthRateLimiter`. */
const AuthThrottle = () =>
  Throttle({ default: { limit: env.AUTH_THROTTLE_LIMIT, ttl: 60_000 } });

const tokensExample = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…',
  tokenType: 'Bearer',
  expiresIn: 900,
};

/**
 * Sign-in for staff and customers (F02). Access tokens are returned in the
 * body; the refresh token travels only in the httpOnly `sw_refresh` cookie
 * (path /auth). There is no staff registration endpoint.
 */
@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signIn: SignInService,
    private readonly accountSetup: AccountSetupService,
    private readonly customerAuth: CustomerAuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly authTokens: AuthTokensService,
  ) {}

  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  @ApiOperation({ summary: 'Staff / platform admin sign-in' })
  @ApiOkResponse({ schema: { example: tokensExample } })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  async staffLogin(
    @Body({ schema: loginSchema }) body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.signIn.verifyStaff(body.email, body.password);
    return this.authTokens.signIn(user, SignInMethod.PASSWORD, res);
  }

  @Get('account-setup/:token')
  @ApiOperation({ summary: 'Who a set-password link is for (410 if dead)' })
  @ApiOkResponse({
    schema: {
      example: {
        email: 'owner@glow.example',
        name: 'Asha',
        businessName: null,
      },
    },
  })
  @ApiGoneResponse({ description: 'LINK_EXPIRED' })
  describeAccountSetup(
    @Param('token', { schema: accountSetupTokenParamSchema }) token: string,
  ) {
    return this.accountSetup.describe(token);
  }

  @Post('account-setup')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  @ApiOperation({ summary: 'Set the first password and sign in' })
  @ApiOkResponse({ schema: { example: tokensExample } })
  @ApiGoneResponse({ description: 'LINK_EXPIRED' })
  async completeAccountSetup(
    @Body({ schema: completeAccountSetupSchema }) body: CompleteAccountSetupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.accountSetup.complete(body.token, body.password);
    return this.authTokens.signIn(user, SignInMethod.PASSWORD, res);
  }

  @Post('customer/login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  @ApiOperation({ summary: 'Customer sign-in with a password' })
  @ApiOkResponse({ schema: { example: tokensExample } })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  async customerLogin(
    @Body({ schema: loginSchema }) body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const account = await this.signIn.verifyCustomer(body.email, body.password);
    return this.authTokens.signIn(account, SignInMethod.PASSWORD, res);
  }

  @Post('customer/magic-link')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthThrottle()
  @ApiOperation({
    summary:
      'Email a sign-in link (always 202, whether or not the email exists)',
  })
  @ApiAcceptedResponse()
  async requestMagicLink(
    @Body({ schema: magicLinkRequestSchema }) body: MagicLinkRequestDto,
  ) {
    await this.customerAuth.requestMagicLink(body.email, body.tenantSlug);
  }

  @Post('customer/magic-link/verify')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  @ApiOperation({ summary: 'Exchange a magic link for tokens' })
  @ApiOkResponse({ schema: { example: tokensExample } })
  @ApiGoneResponse({ description: 'LINK_EXPIRED' })
  async verifyMagicLink(
    @Body({ schema: magicLinkVerifySchema }) body: MagicLinkVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const account = await this.customerAuth.verifyMagicLink(body.token);
    return this.authTokens.signIn(account, SignInMethod.EMAIL_LINK, res);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and get a new access token',
    description:
      'A refresh token works once. Presenting a used one revokes its whole family (401): sign in again.',
  })
  @ApiOkResponse({ schema: { example: tokensExample } })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or reused' })
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.authTokens.readRefreshCookie(req);
    if (!refreshToken) {
      throw new DomainError(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.Unauthenticated,
        'No refresh token',
      );
    }
    return this.authTokens.refresh(refreshToken, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign this device out (revokes its refresh token)' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authTokens.signOut(this.authTokens.readRefreshCookie(req), res);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthThrottle()
  @ApiOperation({
    summary: 'Email a password-reset link (always 202)',
  })
  @ApiAcceptedResponse()
  async forgotPassword(
    @Body({ schema: forgotPasswordSchema }) body: ForgotPasswordDto,
  ) {
    await this.passwordReset.requestReset(body.email, body.accountType);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthThrottle()
  @ApiOperation({
    summary: 'Set a new password from a reset link; signs out everywhere',
  })
  @ApiNoContentResponse()
  @ApiGoneResponse({ description: 'LINK_EXPIRED' })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordDto,
  ) {
    await this.passwordReset.reset(body.token, body.accountType, body.password);
  }
}
