import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../../shared/database/prisma-errors.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import type { CustomerPrincipal } from '../auth.types.js';
import { AccountKind } from '../../../shared/context/request-context.js';

type Db = PrismaService | Prisma.TransactionClient;

const principalSelect = {
  id: true,
  email: true,
  passwordHash: true,
  emailVerifiedAt: true,
} as const;

function toPrincipal(row: {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}): CustomerPrincipal {
  return {
    kind: AccountKind.CUSTOMER,
    id: row.id,
    email: row.email,
    hasPassword: row.passwordHash !== null,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

/**
 * An account nobody ever proved or used, created before `cutoff`: email never
 * verified, no password, no Google / Microsoft link, and no magic link
 * requested since `cutoff` (someone asking again is still trying to sign in).
 * Every way of signing in either verifies the email or needs a password or a
 * link, so such an account has never been signed in to and owns nothing.
 */
export function abandonedSince(cutoff: Date): Prisma.CustomerAccountWhereInput {
  return {
    emailVerifiedAt: null,
    passwordHash: null,
    createdAt: { lt: cutoff },
    identities: { none: {} },
    magicLinkTokens: { none: { createdAt: { gte: cutoff } } },
  };
}

/** `CustomerAccount` rows. The password hash leaves this class only for verification. */
@Injectable()
export class CustomerAccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCredentials(email: string) {
    const row = await this.prisma.customerAccount.findUnique({
      where: { email },
      select: principalSelect,
    });
    return row && { account: toPrincipal(row), passwordHash: row.passwordHash };
  }

  async findPrincipal(id: string): Promise<CustomerPrincipal | null> {
    const row = await this.prisma.customerAccount.findUnique({
      where: { id },
      select: principalSelect,
    });
    return row && toPrincipal(row);
  }

  async findPasswordHash(id: string): Promise<string | null> {
    const row = await this.prisma.customerAccount.findUnique({
      where: { id },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }

  async findIdByEmail(email: string): Promise<string | null> {
    const row = await this.prisma.customerAccount.findUnique({
      where: { email },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * What social sign-in needs to decide whether an existing account may be
   * joined by email (F02 v2): verified?, a password?, which providers linked?
   */
  async findForSocialLink(email: string) {
    const row = await this.prisma.customerAccount.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifiedAt: true,
        passwordHash: true,
        identities: { select: { provider: true } },
      },
    });
    return (
      row && {
        id: row.id,
        emailVerified: row.emailVerifiedAt !== null,
        hasPassword: row.passwordHash !== null,
        providers: row.identities.map((identity) => identity.provider),
      }
    );
  }

  /**
   * Ids of abandoned accounts (see `abandonedSince`), oldest first. The nightly
   * cleanup (F15) deletes them in batches with `deleteAbandoned()`.
   */
  async findAbandonedIds(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.customerAccount.findMany({
      where: abandonedSince(cutoff),
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Deletes those of `ids` that are still abandoned: the conditions are
   * checked again in the DELETE itself, so an account verified or used
   * since `findAbandonedIds()` survives. Leftover magic-link tokens go with
   * it (ON DELETE CASCADE). Returns how many were deleted.
   */
  async deleteAbandoned(ids: string[], cutoff: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.customerAccount.deleteMany({
      where: { id: { in: ids }, ...abandonedSince(cutoff) },
    });
    return count;
  }

  /** A new account whose email a provider already verified (social sign-up). */
  async createVerified(
    email: string,
    now: Date,
    db: Db = this.prisma,
  ): Promise<string> {
    const row = await db.customerAccount.create({
      data: { email, emailVerifiedAt: now },
      select: { id: true },
    });
    return row.id;
  }

  /** The account's id, creating it when the email is new. Safe under concurrent calls. */
  async findOrCreate(email: string): Promise<string> {
    try {
      const row = await this.prisma.customerAccount.upsert({
        where: { email },
        create: { email },
        update: {},
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      // Two first-time requests raced on the insert: the other one won.
      if (!isPrismaError(error, PrismaErrorCode.UniqueViolation)) throw error;
      const existing = await this.findIdByEmail(email);
      if (!existing) throw error;
      return existing;
    }
  }

  async markEmailVerified(
    id: string,
    now: Date,
    db: Db = this.prisma,
  ): Promise<CustomerPrincipal> {
    const row = await db.customerAccount.update({
      where: { id },
      data: { emailVerifiedAt: now },
      select: principalSelect,
    });
    return toPrincipal(row);
  }

  /** Sets the password; opening an emailed link also proves the address. */
  async setPassword(
    id: string,
    passwordHash: string,
    now: Date,
    db: Db = this.prisma,
  ): Promise<CustomerPrincipal> {
    const row = await db.customerAccount.update({
      where: { id },
      data: { passwordHash, emailVerifiedAt: now },
      select: principalSelect,
    });
    return toPrincipal(row);
  }

  async updatePasswordHash(id: string, passwordHash: string) {
    await this.prisma.customerAccount.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
  }
}
