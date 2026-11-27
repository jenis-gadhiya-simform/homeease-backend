import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { env } from '../../config/env.js';
import { EmailModule } from '../email/email.module.js';
import { AccountKindGuard } from './account-kind.guard.js';
import { AccountSetupService } from './account-setup.service.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { AuthController } from './auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { JwtAuth } from './jwt-auth.provider.js';
import { MeController } from './me.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { AccountSetupTokensRepository } from './repositories/account-setup-tokens.repository.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import { MagicLinkTokensRepository } from './repositories/magic-link-tokens.repository.js';
import { SignInService } from './sign-in.service.js';
import { PrismaRefreshTokenStore } from './repositories/prisma-refresh-token.store.js';
import { UsersRepository } from './repositories/users.repository.js';
import { SOCIAL_LOGIN_TTL_MS } from './auth.constants.js';
import { CustomerIdentitiesRepository } from './repositories/customer-identities.repository.js';
import { NoSessionStore } from './social/no-session.store.js';
import { OidcProfileCapture } from './social/oidc-profile-capture.js';
import { RedisOidcStateStore } from './social/redis-oidc-state.store.js';
import { SocialAuthController } from './social/social-auth.controller.js';
import { SocialSignInService } from './social/social-sign-in.service.js';
import {
  socialCallbackUrl,
  socialProviderConfigs,
} from './social/social-providers.js';
import { UnverifiedAccountsCleanupService } from './unverified-accounts-cleanup.service.js';
import './auth.types.js';

/** Issuer and audience of our access tokens, checked on every request. */
export const TOKEN_ISSUER = 'slotwise';
export const TOKEN_AUDIENCE = 'slotwise-api';

/**
 * Authentication (F02) with `@nestjs/authentication`: a global guard puts
 * every route behind a bearer token (`@Public()` opens one), `JwtAuth` loads
 * the staff user or customer account on each request, and refresh tokens
 * rotate in PostgreSQL with reuse detection.
 *
 * Import before RateLimitModule, so the throttler runs after authentication.
 * Exports `AccountSetupService` for flows that create staff users (F01, F04),
 * and `UnverifiedAccountsCleanupService` for the nightly cleanup job (F15).
 */
@Module({
  imports: [
    AuthenticationModule.forRoot({
      accessToken: {
        key: env.JWT_SECRET,
        ttl: env.ACCESS_TOKEN_TTL,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
      },
      refreshToken: { ttl: env.REFRESH_TOKEN_TTL, absoluteTtl: '90d' },
      // Customer sign-in with Google / Microsoft (F02 v2). Only the enabled
      // providers are listed; the others answer 404.
      oidc: {
        callbackUrl: socialCallbackUrl(),
        providers: socialProviderConfigs(),
        transactionTtl: `${SOCIAL_LOGIN_TTL_MS / 60_000}m`,
      },
    }),
    EmailModule,
  ],
  controllers: [AuthController, MeController, SocialAuthController],
  providers: [
    JwtAuth,
    PrismaRefreshTokenStore,
    RedisOidcStateStore,
    NoSessionStore,
    OidcProfileCapture,
    CustomerIdentitiesRepository,
    SocialSignInService,
    UsersRepository,
    CustomerAccountsRepository,
    AccountSetupTokensRepository,
    MagicLinkTokensRepository,
    AuthRateLimiter,
    AuthTokensService,
    SignInService,
    AccountSetupService,
    CustomerAuthService,
    PasswordResetService,
    AccountKindGuard,
    UnverifiedAccountsCleanupService,
  ],
  exports: [
    AccountSetupService,
    AuthTokensService,
    AccountKindGuard,
    UsersRepository,
    UnverifiedAccountsCleanupService,
  ],
})
export class AuthModule {}
