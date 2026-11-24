import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { PrismaService } from '../../shared/database/prisma.service.js';
import {
  generateOneTimeToken,
  hashOneTimeToken,
} from '../../shared/security/one-time-token.js';
import { EmailService } from '../email/email.service.js';
import { linkExpired } from './account-setup.service.js';
import { appLink } from './auth-links.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { AuthTokensService } from './auth-tokens.service.js';
import {
  CUSTOMER_RESET_TOKEN_TTL_MS,
  LINK_PATHS,
  STAFF_RESET_TOKEN_TTL_MS,
} from './auth.constants.js';
import type { PrincipalKind } from './auth.types.js';
import { AccountSetupTokensRepository } from './repositories/account-setup-tokens.repository.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import { MagicLinkTokensRepository } from './repositories/magic-link-tokens.repository.js';
import { UsersRepository } from './repositories/users.repository.js';

/**
 * Forgotten passwords. Staff: an `AccountSetupToken` with purpose RESET;
 * customers: a `MagicLinkToken` with purpose RESET. Both 30 minutes, single
 * use. A reset ends every refresh-token family of the account.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly staffTokens: AccountSetupTokensRepository,
    private readonly customers: CustomerAccountsRepository,
    private readonly customerTokens: MagicLinkTokensRepository,
    private readonly hasher: PasswordHasher,
    private readonly emails: EmailService,
    private readonly limiter: AuthRateLimiter,
    private readonly authTokens: AuthTokensService,
  ) {}

  /**
   * Emails a reset link when an account exists (staff: only ACTIVE ones; a
   * pending user needs their setup link resent instead). The caller always
   * answers 202.
   */
  async requestReset(email: string, kind: PrincipalKind): Promise<void> {
    await this.limiter.hit(`${kind}-reset`, email);
    const now = new Date();
    const { token, tokenHash } = generateOneTimeToken();
    const jobId = `password-reset-${tokenHash.slice(0, 32)}`;

    if (kind === 'staff') {
      const user = await this.users.findActiveByEmail(email);
      if (!user) return;
      await this.staffTokens.replace(
        {
          userId: user.id,
          purpose: 'RESET',
          tokenHash,
          expiresAt: new Date(now.getTime() + STAFF_RESET_TOKEN_TTL_MS),
        },
        now,
      );
      await this.emails.enqueue(
        'password-reset',
        user.email,
        {
          name: user.name,
          actionUrl: appLink(LINK_PATHS.staffPasswordReset, { token }),
          expiresInMinutes: STAFF_RESET_TOKEN_TTL_MS / 60_000,
        },
        { jobId },
      );
      return;
    }

    const accountId = await this.customers.findIdByEmail(email);
    if (!accountId) return;
    await this.customerTokens.replace(
      {
        accountId,
        purpose: 'RESET',
        tokenHash,
        expiresAt: new Date(now.getTime() + CUSTOMER_RESET_TOKEN_TTL_MS),
      },
      now,
    );
    await this.emails.enqueue(
      'password-reset',
      email,
      {
        actionUrl: appLink(LINK_PATHS.customerPasswordReset, { token }),
        expiresInMinutes: CUSTOMER_RESET_TOKEN_TTL_MS / 60_000,
      },
      { jobId },
    );
  }

  /** Sets the new password and signs the account out everywhere; 410 if the link is dead. */
  async reset(
    token: string,
    kind: PrincipalKind,
    password: string,
  ): Promise<void> {
    const tokenHash = hashOneTimeToken(token);
    const accountId =
      kind === 'staff'
        ? await this.resetStaff(tokenHash, password)
        : await this.resetCustomer(tokenHash, password);
    await this.authTokens.signOutEverywhere(accountId);
  }

  private async resetStaff(tokenHash: string, password: string) {
    const open = await this.staffTokens.findOpen(
      tokenHash,
      'RESET',
      new Date(),
    );
    const user = open && (await this.users.findProfile(open.userId));
    if (!open || user?.status !== 'ACTIVE') throw linkExpired();
    const passwordHash = await this.hasher.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      if (!(await this.staffTokens.consume(open.id, now, tx))) {
        throw linkExpired();
      }
      await this.staffTokens.revokeOpen(open.userId, 'RESET', now, tx);
      await this.users.updatePasswordHash(open.userId, passwordHash, tx);
    });
    return open.userId;
  }

  private async resetCustomer(tokenHash: string, password: string) {
    const open = await this.customerTokens.findOpen(
      tokenHash,
      'RESET',
      new Date(),
    );
    if (!open) throw linkExpired();
    const passwordHash = await this.hasher.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      if (!(await this.customerTokens.consume(open.id, now, tx))) {
        throw linkExpired();
      }
      await this.customers.setPassword(open.accountId, passwordHash, now, tx);
    });
    return open.accountId;
  }
}
