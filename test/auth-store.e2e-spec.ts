import type { AuthenticationStorage } from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import type { PrismaRefreshTokenStore as StoreType } from '../src/modules/auth/repositories/prisma-refresh-token.store.js';
import type { PrismaService as PrismaServiceType } from '../src/shared/database/prisma.service.js';

// Requires `docker compose up -d` (Postgres). Runs @nestjs/authentication's
// own contract suite against our PostgreSQL refresh-token store, with the
// concurrency cases (one conditional write per mark, reuse detection).
const { PrismaService } =
  await import('../src/shared/database/prisma.service.js');
const { PrismaRefreshTokenStore } =
  await import('../src/modules/auth/repositories/prisma-refresh-token.store.js');

const prisma: PrismaServiceType = new PrismaService();
const noopStorage = {
  registerSource: () => undefined,
} as unknown as AuthenticationStorage;

const cases = authenticationStoreContract(
  () => ({
    refreshTokens: new PrismaRefreshTokenStore(
      prisma,
      noopStorage,
    ) as StoreType,
  }),
  { contracts: ['refreshTokens'], concurrent: true },
);

describe('PrismaRefreshTokenStore (contract)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    await c.run();
  });
});
