import { HttpStatus, Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import {
  AccountTokenPurpose,
  type Prisma,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import {
  generateOneTimeToken,
  hashOneTimeToken,
} from '../../shared/security/one-time-token.js';
import { appLink } from './auth-links.js';
import { LINK_PATHS, SETUP_TOKEN_TTL_MS } from './auth.constants.js';
import type { StaffPrincipal } from './auth.types.js';
import { AccountSetupTokensRepository } from './repositories/account-setup-tokens.repository.js';
import { UsersRepository } from './repositories/users.repository.js';

/**
 * Which email a flow that adds a staff user sends after commit (F01, F04):
 * a set-password link for a new or still-pending user, or "you've been
 * added" for one who already has a password.
 */
export const InviteEmailKind = {
  WELCOME: 'welcome',
  ADDED: 'added',
} as const;

/** A freshly created set-password link. The raw token exists only here and in the email. */
export interface SetupLink {
  url: string;
  expiresAt: Date;
}

export const linkExpired = () =>
  new DomainError(
    HttpStatus.GONE,
    ErrorCode.LinkExpired,
    'This link has expired or was already used',
  );

/**
 * Account setup for staff-side users who never self-register (F02): the
 * creating flow (F01 Owner onboarding, F04 add member) calls
 * `createSetupLink()` inside its transaction and emails the URL after commit;
 * the user opens it and sets their own password.
 */
@Injectable()
export class AccountSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly tokens: AccountSetupTokensRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Creates a 72 h single-use link for a `PENDING_SETUP` user, invalidating
   * earlier ones (resend). Pass the caller's `tx` so the link only exists if
   * the user does.
   */
  async createSetupLink(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SetupLink> {
    const now = new Date();
    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);
    await this.tokens.replace(
      { userId, purpose: AccountTokenPurpose.SETUP, tokenHash, expiresAt },
      now,
      tx,
    );
    return { url: appLink(LINK_PATHS.accountSetup, { token }), expiresAt };
  }

  /** Invalidates every open setup and reset link of the user. */
  async revokeLinks(userId: string, tx?: Prisma.TransactionClient) {
    await this.tokens.revokeOpen(userId, undefined, new Date(), tx);
  }

  /** What the set-password page shows before the user types anything; 410 if the link is dead. */
  async describe(token: string) {
    const user = await this.findPendingUser(token);
    const businessName = await this.users.findLatestBusinessName(user.id);
    return { email: user.email, name: user.name, businessName };
  }

  /** Sets the password, activates the user and spends the link. */
  async complete(token: string, password: string): Promise<StaffPrincipal> {
    const { tokenId, ...user } = await this.findPendingUser(token);
    // Hash outside the transaction: it's the slow part.
    const passwordHash = await this.hasher.hash(password);
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      if (!(await this.tokens.consume(tokenId, now, tx))) throw linkExpired();
      await this.tokens.revokeOpen(user.id, AccountTokenPurpose.SETUP, now, tx);
      return this.users.activate(user.id, passwordHash, now, tx);
    });
  }

  private async findPendingUser(token: string) {
    const open = await this.tokens.findOpen(
      hashOneTimeToken(token),
      AccountTokenPurpose.SETUP,
      new Date(),
    );
    const user = open && (await this.users.findProfile(open.userId));
    // A disabled (or already active) user can't be set up through an old link.
    if (!open || !user || user.status !== UserStatus.PENDING_SETUP)
      throw linkExpired();
    return {
      tokenId: open.id,
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }
}
