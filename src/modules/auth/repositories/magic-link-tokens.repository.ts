import { Injectable } from '@nestjs/common';
import type {
  MagicLinkPurpose,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** `MagicLinkToken`: customer sign-in links and customer password-reset links. */
@Injectable()
export class MagicLinkTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores a new link and invalidates the account's earlier open links of the same purpose. */
  async replace(
    data: {
      accountId: string;
      purpose: MagicLinkPurpose;
      tokenHash: string;
      expiresAt: Date;
    },
    now: Date,
  ) {
    await this.prisma.$transaction([
      this.prisma.magicLinkToken.updateMany({
        where: {
          accountId: data.accountId,
          purpose: data.purpose,
          usedAt: null,
        },
        data: { usedAt: now },
      }),
      this.prisma.magicLinkToken.create({ data, select: { id: true } }),
    ]);
  }

  async findOpen(tokenHash: string, purpose: MagicLinkPurpose, now: Date) {
    const row = await this.prisma.magicLinkToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        accountId: true,
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
    return { id: row.id, accountId: row.accountId };
  }

  /** Marks the link used in one conditional write; `true` for exactly one caller. */
  async consume(id: string, now: Date, db: Db = this.prisma) {
    const { count } = await db.magicLinkToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }
}
