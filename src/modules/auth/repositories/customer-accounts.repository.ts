import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  isPrismaError,
  PrismaErrorCode,
} from '../../../shared/database/prisma-errors.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import type { CustomerPrincipal } from '../auth.types.js';

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
    kind: 'customer',
    id: row.id,
    email: row.email,
    hasPassword: row.passwordHash !== null,
    emailVerified: row.emailVerifiedAt !== null,
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
