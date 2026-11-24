import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service.js';
import type { StaffPrincipal } from '../auth.types.js';

type Db = PrismaService | Prisma.TransactionClient;

const principalSelect = {
  id: true,
  email: true,
  name: true,
  isPlatformAdmin: true,
} as const;

function toPrincipal(row: {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}): StaffPrincipal {
  return { kind: 'staff', ...row };
}

/** Staff-side `User` rows. The password hash leaves this class only for verification. */
@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** For sign-in: the user, its status and hash, or null. */
  async findCredentials(email: string) {
    const row = await this.prisma.user.findUnique({
      where: { email },
      select: { ...principalSelect, status: true, passwordHash: true },
    });
    if (!row) return null;
    const { status, passwordHash, ...principal } = row;
    return { user: toPrincipal(principal), status, passwordHash };
  }

  /** The signed-in user, or null when it no longer exists or isn't ACTIVE. */
  async findActivePrincipal(id: string): Promise<StaffPrincipal | null> {
    const row = await this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE' },
      select: principalSelect,
    });
    return row && toPrincipal(row);
  }

  async findActiveByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
    });
  }

  async findProfile(id: string, db: Db = this.prisma) {
    return db.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, status: true },
    });
  }

  /** Completes account setup: sets the password and activates the user. */
  async activate(
    id: string,
    passwordHash: string,
    now: Date,
    db: Db = this.prisma,
  ): Promise<StaffPrincipal> {
    const row = await db.user.update({
      where: { id },
      data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: now },
      select: principalSelect,
    });
    return toPrincipal(row);
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    db: Db = this.prisma,
  ) {
    await db.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
  }

  /** For flows that add a staff user to a business (F01, F04). */
  async findByEmail(email: string, db: Db = this.prisma) {
    return db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isPlatformAdmin: true,
      },
    });
  }

  /** A new staff user who sets their own password later (account setup). */
  async createPending(
    data: { email: string; name: string },
    db: Db = this.prisma,
  ) {
    return db.user.create({
      data: { email: data.email, name: data.name, status: 'PENDING_SETUP' },
      select: { id: true, email: true, name: true, status: true },
    });
  }

  async setStatus(
    id: string,
    status: 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED',
    db: Db = this.prisma,
  ) {
    await db.user.update({
      where: { id },
      data: { status },
      select: { id: true },
    });
  }

  /** The business the user was most recently added to (for the set-password page). */
  async findLatestBusinessName(userId: string): Promise<string | null> {
    const membership = await this.tenantPrisma.runAsUser(userId, (tx) =>
      tx.membership.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: { tenant: { select: { name: true } } },
      }),
    );
    return membership?.tenant.name ?? null;
  }
}
