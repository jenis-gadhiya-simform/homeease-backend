import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OidcService, type OidcProfile } from '@nestjs/authentication';
import { InjectRedis } from '@nestjs-redis/client';
import type { RedisClientType } from 'redis';
import { env } from '../../../config/env.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../../shared/database/prisma-errors.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { DomainError, ErrorCode } from '../../../shared/errors/domain-error.js';
import {
  generateOneTimeToken,
  hashOneTimeToken,
} from '../../../shared/security/one-time-token.js';
import { LINK_INTENT_TTL_MS, SOCIAL_LOGIN_TTL_MS } from '../auth.constants.js';
import type { CustomerPrincipal } from '../auth.types.js';
import { CustomerAccountsRepository } from '../repositories/customer-accounts.repository.js';
import { CustomerIdentitiesRepository } from '../repositories/customer-identities.repository.js';
import { VerifiedOidcProfile } from './oidc-profile-capture.js';
import {
  enabledSocialProviders,
  isSocialProvider,
  type SocialProvider,
  toIdentityProvider,
  toSocialProvider,
} from './social-providers.js';

/** Whether a social login signs in, or links a provider to a signed-in account. */
export const SocialLoginMode = {
  SIGN_IN: 'sign-in',
  LINK: 'link',
} as const;
export type SocialLoginMode =
  (typeof SocialLoginMode)[keyof typeof SocialLoginMode];

/** What we keep with a login in progress, keyed by its `state` (Redis). */
export type SocialLoginContext =
  | {
      mode: typeof SocialLoginMode.SIGN_IN;
      /** Relative path in the web app to land on. */
      redirectTo?: string;
      tenantSlug?: string;
    }
  | { mode: typeof SocialLoginMode.LINK; accountId: string };

export type SocialLoginOutcome =
  | {
      mode: typeof SocialLoginMode.SIGN_IN;
      account: CustomerPrincipal;
      context: Extract<
        SocialLoginContext,
        { mode: typeof SocialLoginMode.SIGN_IN }
      >;
    }
  | { mode: typeof SocialLoginMode.LINK; provider: SocialProvider }
  | { mode: SocialLoginMode; error: ErrorCode };

const contextKey = (state: string) => `oidc-context:${state}`;
const intentKey = (tokenHash: string) => `oidc-link-intent:${tokenHash}`;

/** Codes the browser may see; anything else becomes SOCIAL_SIGN_IN_FAILED. */
const BROWSER_ERROR_CODES: readonly ErrorCode[] = [
  ErrorCode.EmailNotVerified,
  ErrorCode.AccountLinkRequired,
  ErrorCode.IdentityInUse,
  ErrorCode.ProviderAlreadyLinked,
  ErrorCode.LinkExpired,
];

const providerNotEnabled = () =>
  new DomainError(
    HttpStatus.NOT_FOUND,
    ErrorCode.NotFound,
    'This sign-in provider is not enabled',
  );

/**
 * Customer sign-in with Google and Microsoft (F02 v2).
 *
 * The OpenID Connect protocol (PKCE, state bound to the browser, nonce, ID
 * token checks) is `OidcService` from `@nestjs/authentication`; its resolver
 * hands the verified profile back here (see `OidcProfileCapture`). This
 * class decides which customer account the identity belongs to. Tokens are
 * issued by the caller (`AuthTokensService`), like every other sign-in.
 */
@Injectable()
export class SocialSignInService {
  private readonly logger = new Logger(SocialSignInService.name);

  constructor(
    private readonly oidc: OidcService,
    @InjectRedis() private readonly redis: RedisClientType,
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsRepository,
    private readonly identities: CustomerIdentitiesRepository,
  ) {}

  enabledProviders(): SocialProvider[] {
    return enabledSocialProviders();
  }

  assertEnabled(provider: SocialProvider): void {
    if (!this.enabledProviders().includes(provider)) throw providerNotEnabled();
  }

  /**
   * Starts a login: the provider's authorization URL, plus the cookies that
   * bind it to this browser (the package also sets them on the response).
   */
  async start(provider: SocialProvider, context: SocialLoginContext) {
    this.assertEnabled(provider);
    const { url, cookies } = await this.oidc.start(provider);
    const state = new URL(url).searchParams.get('state');
    if (!state) throw new Error('OIDC authorization URL without state');
    await this.redis.set(contextKey(state), JSON.stringify(context), {
      expiration: { type: 'PX', value: SOCIAL_LOGIN_TTL_MS },
    });
    return { url, cookies };
  }

  /** Spends a link intent (single use, bound to account and provider) and starts a link login. */
  async startLink(provider: SocialProvider, intent: string) {
    this.assertEnabled(provider);
    const raw = await this.redis.getDel(intentKey(hashOneTimeToken(intent)));
    const stored = raw
      ? (JSON.parse(raw) as { accountId: string; provider: string })
      : null;
    if (!stored || stored.provider !== provider) {
      throw new DomainError(
        HttpStatus.GONE,
        ErrorCode.LinkExpired,
        'This link has expired. Start again from your account.',
      );
    }
    return this.start(provider, {
      mode: SocialLoginMode.LINK,
      accountId: stored.accountId,
    });
  }

  /**
   * A one-time URL that starts linking `provider` to the signed-in account.
   * The browser must navigate to it (a bearer token can't ride along on a
   * top-level redirect), so the account travels as a 5-minute intent.
   */
  async createLinkIntent(accountId: string, provider: SocialProvider) {
    this.assertEnabled(provider);
    const { token, tokenHash } = generateOneTimeToken();
    await this.redis.set(
      intentKey(tokenHash),
      JSON.stringify({ accountId, provider }),
      { expiration: { type: 'PX', value: LINK_INTENT_TTL_MS } },
    );
    const url = new URL(`/auth/customer/oidc/${provider}/login`, env.API_URL);
    url.searchParams.set('intent', token);
    return { url: url.toString() };
  }

  /**
   * Completes a login on the callback. Never throws for anything the
   * browser did or the provider answered: the outcome says where to send it.
   */
  async finish(
    provider: SocialProvider,
    query: Record<string, unknown>,
  ): Promise<SocialLoginOutcome> {
    const state = typeof query.state === 'string' ? query.state : undefined;
    let profile: OidcProfile | undefined;
    let failure: unknown;
    try {
      this.assertEnabled(provider);
      await this.oidc.finish(provider, query);
      failure = new Error('OidcProfileCapture did not capture the profile');
    } catch (error) {
      if (error instanceof VerifiedOidcProfile) profile = error.profile;
      else failure = error;
    }

    if (!profile || !state) {
      // Only peek: an unverified `state` must not consume another browser's login.
      const context = state ? await this.readContext(state, false) : null;
      return this.failed(context?.mode, failure);
    }

    // The package matched `state` to this browser's cookie: the context is ours.
    const context = await this.readContext(state, true);
    if (!context) return this.failed(undefined, 'login context expired');
    try {
      if (context.mode === SocialLoginMode.LINK) {
        await this.link(context.accountId, profile);
        return { mode: SocialLoginMode.LINK, provider };
      }
      const account = await this.signIn(profile);
      return { mode: SocialLoginMode.SIGN_IN, account, context };
    } catch (error) {
      return this.failed(context.mode, error);
    }
  }

  /**
   * The account a verified provider profile signs in to, creating or joining
   * one when the rules allow (F02 v2, "Resolver rules"). Retried once when a
   * concurrent first sign-in won a unique constraint: the second pass finds
   * its rows.
   */
  async signIn(profile: OidcProfile): Promise<CustomerPrincipal> {
    try {
      return await this.signInOnce(profile);
    } catch (error) {
      if (!isPrismaError(error, PrismaErrorCode.UniqueViolation)) throw error;
      return this.signInOnce(profile);
    }
  }

  private async signInOnce(profile: OidcProfile): Promise<CustomerPrincipal> {
    const provider = toIdentityProvider(this.providerOf(profile));
    const now = new Date();

    const linkedId = await this.identities.findAccountId(
      provider,
      profile.subject,
    );
    if (linkedId) {
      await this.identities.touch(provider, profile.subject, now);
      return this.principal(linkedId);
    }

    // Email decides only when the provider vouched for it.
    const email = normalizeEmail(profile.email);
    if (!email || !profile.emailVerified) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.EmailNotVerified,
        'Your provider did not confirm this email address. Sign in with an email link, then connect it from your account.',
      );
    }
    const identity = { provider, subject: profile.subject, email };

    const existing = await this.accounts.findForSocialLink(email);
    if (!existing) {
      const accountId = await this.prisma.$transaction(async (tx) => {
        const id = await this.accounts.createVerified(email, now, tx);
        await this.identities.create({ ...identity, accountId: id }, now, tx);
        return id;
      });
      return this.principal(accountId);
    }

    if (existing.providers.includes(provider)) {
      // The account already has another account of this provider linked.
      throw new DomainError(
        HttpStatus.CONFLICT,
        ErrorCode.ProviderAlreadyLinked,
        'A different account of this provider is already connected to this email.',
      );
    }
    if (existing.emailVerified) {
      // Both sides proved the address.
      await this.identities.create(
        { ...identity, accountId: existing.id },
        now,
      );
      return this.principal(existing.id);
    }
    if (!existing.hasPassword && existing.providers.length === 0) {
      // Never verified, no password, nothing linked: an unclaimed shell (a
      // magic link was requested but never opened). Nobody else can sign in
      // to it, so the verified owner claims it.
      await this.prisma.$transaction(async (tx) => {
        await this.accounts.markEmailVerified(existing.id, now, tx);
        await this.identities.create(
          { ...identity, accountId: existing.id },
          now,
          tx,
        );
      });
      return this.principal(existing.id);
    }
    throw new DomainError(
      HttpStatus.CONFLICT,
      ErrorCode.AccountLinkRequired,
      'An account with this email already exists. Sign in with an email link, then connect it from your account.',
    );
  }

  /**
   * Links the identity to a signed-in account. Its email doesn't have to
   * match: the customer proved both sides (signed in + provider login).
   */
  async link(accountId: string, profile: OidcProfile): Promise<void> {
    const provider = toIdentityProvider(this.providerOf(profile));
    const owner = await this.identities.findAccountId(
      provider,
      profile.subject,
    );
    if (owner === accountId) return;
    if (owner) throw identityInUse();
    if (!(await this.accounts.findPrincipal(accountId))) {
      throw new DomainError(
        HttpStatus.GONE,
        ErrorCode.LinkExpired,
        'This account no longer exists',
      );
    }
    try {
      await this.identities.create(
        {
          accountId,
          provider,
          subject: profile.subject,
          email: normalizeEmail(profile.email),
        },
        new Date(),
      );
    } catch (error) {
      if (!isPrismaError(error, PrismaErrorCode.UniqueViolation)) throw error;
      // Either the identity was linked meanwhile, or the account has another one of this provider.
      const winner = await this.identities.findAccountId(
        provider,
        profile.subject,
      );
      if (winner === accountId) return;
      if (winner) throw identityInUse();
      throw new DomainError(
        HttpStatus.CONFLICT,
        ErrorCode.ProviderAlreadyLinked,
        'Disconnect the account of this provider that is already connected first.',
      );
    }
  }

  async list(accountId: string) {
    const rows = await this.identities.listForAccount(accountId);
    return rows.map((row) => ({
      provider: toSocialProvider(row.provider),
      email: row.email,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  async providerNames(accountId: string): Promise<SocialProvider[]> {
    return (await this.list(accountId)).map((identity) => identity.provider);
  }

  /** Always allowed: a magic link to the account's email still signs the customer in. */
  async unlink(accountId: string, provider: SocialProvider): Promise<void> {
    const removed = await this.identities.delete(
      accountId,
      toIdentityProvider(provider),
    );
    if (!removed) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ErrorCode.NotFound,
        'This provider is not connected',
      );
    }
  }

  private providerOf(profile: OidcProfile): SocialProvider {
    if (!isSocialProvider(profile.provider)) {
      throw new Error(`Unexpected OIDC provider "${profile.provider}"`);
    }
    return profile.provider;
  }

  private async principal(accountId: string): Promise<CustomerPrincipal> {
    const account = await this.accounts.findPrincipal(accountId);
    if (!account) throw new Error(`Customer account ${accountId} vanished`);
    return account;
  }

  private async readContext(
    state: string,
    consume: boolean,
  ): Promise<SocialLoginContext | null> {
    const raw = consume
      ? await this.redis.getDel(contextKey(state))
      : await this.redis.get(contextKey(state));
    return raw ? (JSON.parse(raw) as SocialLoginContext) : null;
  }

  /** Our domain codes pass through; everything else is logged and reported generically. */
  private failed(
    mode: SocialLoginMode | undefined,
    reason: unknown,
  ): SocialLoginOutcome {
    const code =
      reason instanceof DomainError && BROWSER_ERROR_CODES.includes(reason.code)
        ? reason.code
        : ErrorCode.SocialSignInFailed;
    if (code === ErrorCode.SocialSignInFailed) {
      this.logger.warn({ err: reason }, 'Social sign-in failed');
    }
    return { mode: mode ?? SocialLoginMode.SIGN_IN, error: code };
  }
}

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

const identityInUse = () =>
  new DomainError(
    HttpStatus.CONFLICT,
    ErrorCode.IdentityInUse,
    'This account is already connected to another SlotWise account.',
  );
