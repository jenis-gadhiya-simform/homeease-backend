import { Injectable } from '@nestjs/common';
import type {
  IdentityProvider,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

export interface NewIdentity {
  accountId: string;
  provider: IdentityProvider;
  subject: string;
  email?: string;
}

/** `CustomerIdentity` rows: Google / Microsoft identities linked to customer accounts (F02 v2). */
@Injectable()
export class CustomerIdentitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The account a provider identity is linked to, if any. */
  async findAccountId(
    provider: IdentityProvider,
    subject: string,
  ): Promise<string | null> {
    const row = await this.prisma.customerIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      select: { accountId: true },
    });
    return row?.accountId ?? null;
  }

  /** Inserts a link. Unique violations (identity or provider already linked) are the caller's to map. */
  async create(identity: NewIdentity, now: Date, db: Db = this.prisma) {
    await db.customerIdentity.create({
      data: { ...identity, createdAt: now, lastUsedAt: now },
      select: { id: true },
    });
  }

  async touch(provider: IdentityProvider, subject: string, now: Date) {
    await this.prisma.customerIdentity.updateMany({
      where: { provider, subject },
      data: { lastUsedAt: now },
    });
  }

  async listForAccount(accountId: string) {
    return this.prisma.customerIdentity.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: {
        provider: true,
        email: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }

  /** `true` when a link was removed. */
  async delete(accountId: string, provider: IdentityProvider) {
    const { count } = await this.prisma.customerIdentity.deleteMany({
      where: { accountId, provider },
    });
    return count > 0;
  }
}
