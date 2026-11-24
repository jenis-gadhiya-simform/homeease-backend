import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';

/**
 * Refresh tokens for `TokenService`, in PostgreSQL (`refresh_token` +
 * `refresh_token_family`), so they survive restarts and are shared by every
 * instance. Tokens are stored as the SHA-256 the package hands us (`id`).
 *
 * Checked by `authenticationStoreContract()` in test/auth-store.e2e-spec.ts.
 */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { id },
      select: {
        id: true,
        familyId: true,
        userId: true,
        claims: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        family: { select: { expiresAt: true } },
      },
    });
    if (!row) return undefined;
    return {
      id: row.id,
      familyId: row.familyId,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      // Saved with every token, so set for every family that has one.
      familyExpiresAt: row.family.expiresAt ?? row.expiresAt,
      // Optional fields come back absent, never null.
      ...(row.usedAt && { usedAt: row.usedAt }),
      ...(row.claims !== null && {
        claims: row.claims as Record<string, unknown>,
      }),
    };
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    // The family row may already exist (rotation, or an early revocation):
    // keep its revokedAt, so a revoked family stays revoked.
    await this.prisma.$executeRaw`
      INSERT INTO refresh_token_family (id, user_id, expires_at)
      VALUES (${record.familyId}, ${record.userId}, ${record.familyExpiresAt})
      ON CONFLICT (id) DO UPDATE
        SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`;
    await this.prisma.refreshToken.create({
      data: {
        id: record.id,
        familyId: record.familyId,
        userId: record.userId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        usedAt: record.usedAt ?? null,
        claims: (record.claims ?? undefined) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // Keep the tables bounded: families past their absolute lifetime can't
    // be refreshed anyway (their tokens go with them, ON DELETE CASCADE).
    await this.prisma.refreshTokenFamily.deleteMany({
      where: { expiresAt: { lt: record.createdAt } },
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    // An upsert: the revocation must also cover tokens saved after it.
    await this.prisma.$executeRaw`
      INSERT INTO refresh_token_family (id, revoked_at)
      VALUES (${familyId}, now())
      ON CONFLICT (id) DO UPDATE
        SET revoked_at = COALESCE(refresh_token_family.revoked_at, now())`;
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const row = await this.prisma.refreshTokenFamily.findUnique({
      where: { id: familyId },
      select: { revokedAt: true },
    });
    return row?.revokedAt != null;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshTokenFamily.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
