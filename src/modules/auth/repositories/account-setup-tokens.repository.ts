import { Injectable } from '@nestjs/common';
import type {
  AccountTokenPurpose,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** `AccountSetupToken`: staff-side set-password links (SETUP and RESET). */
@Injectable()
export class AccountSetupTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores a new link and invalidates the user's earlier open links of the
   * same purpose (a resend replaces the previous one).
   */
  async replace(
    data: {
      userId: string;
      purpose: AccountTokenPurpose;
      tokenHash: string;
      expiresAt: Date;
    },
    now: Date,
    db: Db = this.prisma,
  ) {
    await this.revokeOpen(data.userId, data.purpose, now, db);
    await db.accountSetupToken.create({ data, select: { id: true } });
  }

  /** The open link's user, or null if unknown, of another purpose, used or expired. */
  async findOpen(tokenHash: string, purpose: AccountTokenPurpose, now: Date) {
    const row = await this.prisma.accountSetupToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        purpose: true,
        usedAt: true,
        expiresAt: true,
      },
    });
    if (
      !row ||
      row.purpose !== purpose ||
      row.usedAt !== null ||
      row.expiresAt <= now
    ) {
      return null;
    }
    return { id: row.id, userId: row.userId };
  }

  /**
   * Marks the link used, in one conditional write: of two concurrent
   * requests with the same link, exactly one gets `true`.
   */
  async consume(id: string, now: Date, db: Db = this.prisma) {
    const { count } = await db.accountSetupToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  /** Invalidates every open link of the user (optionally of one purpose). */
  async revokeOpen(
    userId: string,
    purpose: AccountTokenPurpose | undefined,
    now: Date,
    db: Db = this.prisma,
  ) {
    await db.accountSetupToken.updateMany({
      where: { userId, usedAt: null, ...(purpose && { purpose }) },
      data: { usedAt: now },
    });
  }
}
