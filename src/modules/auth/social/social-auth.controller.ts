import { Controller, Get, HttpStatus, Param, Query, Res } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import {
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { env } from '../../../config/env.js';
import { DomainError, ErrorCode } from '../../../shared/errors/domain-error.js';
import { appLink } from '../auth-links.js';
import { AuthTokensService } from '../auth-tokens.service.js';
import { LINK_PATHS } from '../auth.constants.js';
import {
  appRedirectPathSchema,
  linkIntentSchema,
  socialProviderSchema,
  tenantSlugSchema,
} from '../auth.schemas.js';
import { SignInMethod } from '../auth.types.js';
import {
  SocialLoginMode,
  type SocialLoginOutcome,
  SocialSignInService,
} from './social-sign-in.service.js';
import type { SocialProvider } from './social-providers.js';

/**
 * The cookie `OidcService` binds a login to the browser with (package
 * default: `Secure`, which browsers also accept on http://localhost).
 */
export const OIDC_TX_COOKIE = '__Host-oidc_tx';

/** Per client IP, like the other sign-in routes. */
const AuthThrottle = () =>
  Throttle({ default: { limit: env.AUTH_THROTTLE_LIMIT, ttl: 60_000 } });

/**
 * Customer sign-in with Google and Microsoft (F02 v2). Both routes are
 * browser navigations, not API calls: they answer with redirects. Success
 * sets the `sw_refresh` cookie and lands on the web app, which then calls
 * `POST /auth/refresh` for its access token. No token is ever put in a URL.
 */
@ApiTags('Auth')
@Public()
@Controller('auth/customer/oidc')
export class SocialAuthController {
  constructor(
    private readonly social: SocialSignInService,
    private readonly authTokens: AuthTokensService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Social sign-in providers that are enabled' })
  @ApiOkResponse({ schema: { example: { providers: ['google'] } } })
  providers() {
    return { providers: this.social.enabledProviders() };
  }

  @Get(':provider/login')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Start Google / Microsoft sign-in (browser navigation)',
    description:
      'Redirects to the provider. `redirectTo` (a path in the web app) and `tenantSlug` come back on the final redirect. With `intent` (from `POST /me/identities/:provider/link`) it links the provider to that account instead of signing in.',
  })
  @ApiFoundResponse({ description: 'To the provider' })
  @ApiNotFoundResponse({ description: 'Provider not enabled' })
  async login(
    @Param('provider', { schema: socialProviderSchema })
    provider: SocialProvider,
    @Query('redirectTo', { schema: appRedirectPathSchema })
    redirectTo: string | undefined,
    @Query('tenantSlug', { schema: tenantSlugSchema })
    tenantSlug: string | undefined,
    @Query('intent', { schema: linkIntentSchema }) intent: string | undefined,
    @Res() res: Response,
  ) {
    let started: { url: string; cookies: string[] };
    try {
      started = intent
        ? await this.social.startLink(provider, intent)
        : await this.social.start(provider, {
            mode: SocialLoginMode.SIGN_IN,
            redirectTo,
            tenantSlug,
          });
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === ErrorCode.LinkExpired
      ) {
        return this.redirect(
          res,
          appLink(LINK_PATHS.signInMethods, { error: error.code }),
        );
      }
      throw error;
    }
    this.ensureCookies(res, started.cookies);
    return this.redirect(res, started.url);
  }

  @Get(':provider/callback')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Provider callback (browser navigation)',
    description: `Redirects to the web app: \`${LINK_PATHS.socialCallback}?redirectTo=…\` signed in (refresh cookie set), or \`?error=CODE\`; for a link, \`${LINK_PATHS.signInMethods}?linked=<provider>\` or \`?error=CODE\`.`,
  })
  @ApiFoundResponse({ description: 'To the web app' })
  async callback(
    @Param('provider', { schema: socialProviderSchema })
    provider: SocialProvider,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const outcome = await this.social.finish(provider, query);
    // The login is spent either way; drop its browser binding.
    res.clearCookie(OIDC_TX_COOKIE, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    return this.redirect(res, await this.landing(outcome, res));
  }

  private async landing(
    outcome: SocialLoginOutcome,
    res: Response,
  ): Promise<string> {
    if ('error' in outcome) {
      const path =
        outcome.mode === SocialLoginMode.LINK
          ? LINK_PATHS.signInMethods
          : LINK_PATHS.socialCallback;
      return appLink(path, { error: outcome.error });
    }
    if (outcome.mode === SocialLoginMode.LINK) {
      return appLink(LINK_PATHS.signInMethods, { linked: outcome.provider });
    }
    // Sets the sw_refresh cookie; the access token is fetched with POST /auth/refresh.
    await this.authTokens.signIn(outcome.account, SignInMethod.OIDC, res);
    return appLink(LINK_PATHS.socialCallback, {
      redirectTo: outcome.context.redirectTo,
      tenant: outcome.context.tenantSlug,
    });
  }

  /** The package sets its cookies on the response itself; add any it couldn't. */
  private ensureCookies(res: Response, cookies: string[]) {
    const header = res.getHeader('set-cookie');
    const present = Array.isArray(header)
      ? header
      : header
        ? [String(header)]
        : [];
    for (const cookie of cookies) {
      if (!present.includes(cookie)) res.append('Set-Cookie', cookie);
    }
  }

  private redirect(res: Response, url: string) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(HttpStatus.FOUND, url);
  }
}
