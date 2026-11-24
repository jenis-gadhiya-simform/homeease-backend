import { HttpStatus, Injectable } from '@nestjs/common';
import { PasswordHasher, type JwtClaims } from '@nestjs/authentication';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import {
  generateOneTimeToken,
  hashOneTimeToken,
} from '../../shared/security/one-time-token.js';
import { EmailService } from '../email/email.service.js';
import { linkExpired } from './account-setup.service.js';
import { appLink } from './auth-links.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import {
  FRESH_SIGN_IN_MS,
  LINK_PATHS,
  MAGIC_LINK_TTL_MS,
} from './auth.constants.js';
import { type CustomerPrincipal, SignInMethod } from './auth.types.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import { MagicLinkTokensRepository } from './repositories/magic-link-tokens.repository.js';
import { MagicLinkPurpose } from '../../generated/prisma/client.js';

/** Customer self-service: magic-link sign-in and setting a password. */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly accounts: CustomerAccountsRepository,
    private readonly links: MagicLinkTokensRepository,
    private readonly hasher: PasswordHasher,
    private readonly emails: EmailService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  /**
   * Emails a 15-minute single-use sign-in link, creating the account when
   * the email is new. The caller always answers 202, so the response never
   * tells whether the address had an account.
   */
  async requestMagicLink(email: string, tenantSlug?: string): Promise<void> {
    await this.limiter.hit('magic-link', email);
    const accountId = await this.accounts.findOrCreate(email);
    const now = new Date();
    const { token, tokenHash } = generateOneTimeToken();
    await this.links.replace(
      {
        accountId,
        purpose: MagicLinkPurpose.LOGIN,
        tokenHash,
        expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
      },
      now,
    );
    await this.emails.enqueue(
      'magic-link',
      email,
      {
        actionUrl: appLink(LINK_PATHS.magicLink, { token, tenant: tenantSlug }),
        expiresInMinutes: MAGIC_LINK_TTL_MS / 60_000,
      },
      { jobId: `magic-link-${tokenHash.slice(0, 32)}` },
    );
  }

  /** Spends the link and marks the email verified; 410 if unknown, used or expired. */
  async verifyMagicLink(token: string): Promise<CustomerPrincipal> {
    const now = new Date();
    const open = await this.links.findOpen(
      hashOneTimeToken(token),
      MagicLinkPurpose.LOGIN,
      now,
    );
    if (!open || !(await this.links.consume(open.id, now))) throw linkExpired();
    return this.accounts.markEmailVerified(open.accountId, now);
  }

  /**
   * Sets or changes the password. With one already set, the current password
   * is required; without one, the session must come from a magic link (or a
   * Google / Microsoft sign-in) in the last 15 minutes.
   */
  async changePassword(
    account: CustomerPrincipal,
    session: JwtClaims | null,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<CustomerPrincipal> {
    const currentHash = await this.accounts.findPasswordHash(account.id);
    if (currentHash) {
      const valid =
        currentPassword !== undefined &&
        (await this.hasher.verify(currentPassword, currentHash));
      if (!valid) {
        throw new DomainError(
          HttpStatus.FORBIDDEN,
          ErrorCode.ReauthenticationRequired,
          'The current password is incorrect',
        );
      }
    } else if (!isFreshPasswordlessSignIn(session, Date.now())) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.ReauthenticationRequired,
        'Sign in again with a magic link to set a password',
      );
    }
    const passwordHash = await this.hasher.hash(newPassword);
    return this.accounts.setPassword(account.id, passwordHash, new Date());
  }
}

/** Sign-ins that prove the person without a password: magic link, Google, Microsoft. */
const PASSWORDLESS_METHODS: readonly unknown[] = [
  SignInMethod.EMAIL_LINK,
  SignInMethod.OIDC,
];

/** The access token comes from a passwordless sign-in at most 15 minutes old. */
export function isFreshPasswordlessSignIn(
  claims: JwtClaims | null,
  nowMs: number,
): boolean {
  const amr = Array.isArray(claims?.amr) ? claims.amr : [];
  const authTime = claims?.auth_time;
  return (
    amr.some((method) => PASSWORDLESS_METHODS.includes(method)) &&
    typeof authTime === 'number' &&
    nowMs - authTime * 1000 <= FRESH_SIGN_IN_MS
  );
}
