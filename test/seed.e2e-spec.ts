import { PasswordHasher } from '@nestjs/authentication';
import type { SeedOutcome } from '../prisma/seed/platform-admin.js';
import type { PrismaService as PrismaServiceType } from '../src/shared/database/prisma.service.js';

// Runs against the e2e database (slotwise-test). Requires `docker compose up -d`.
describe('Seed: platform admin (e2e)', () => {
  let prisma: PrismaServiceType;
  let seed: (
    input: { email?: string; password?: string; name?: string },
    resetPassword?: boolean,
  ) => Promise<SeedOutcome>;
  // Cheap hashes for tests; the seed uses the default cost.
  const hasher = new PasswordHasher({ logN: 10 });
  const verifier = new PasswordHasher();

  beforeAll(async () => {
    const { PrismaService } =
      await import('../src/shared/database/prisma.service.js');
    const { seedPlatformAdmin } =
      await import('../prisma/seed/platform-admin.js');
    prisma = new PrismaService();
    seed = (input, resetPassword = false) =>
      seedPlatformAdmin(
        prisma,
        hasher,
        {
          email: input.email,
          password: input.password,
          name: input.name ?? 'Platform Admin',
        },
        { resetPassword },
      );
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const admin = { email: 'Admin@SlotWise.test', password: 'first-pass-2026' };

  it('creates exactly one active platform admin with a lowercased email', async () => {
    await expect(seed(admin)).resolves.toBe('created');

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: 'admin@slotwise.test',
      name: 'Platform Admin',
      isPlatformAdmin: true,
      status: 'ACTIVE',
    });
    expect(users[0].passwordHash).not.toContain(admin.password);
    await expect(
      verifier.verify(admin.password, users[0].passwordHash),
    ).resolves.toBe(true);
  });

  it('is idempotent and keeps the password unless asked to reset it', async () => {
    await seed(admin);
    await expect(
      seed({ ...admin, password: 'second-pass-2026' }),
    ).resolves.toBe('updated');

    const [user] = await prisma.user.findMany();
    expect(await prisma.user.count()).toBe(1);
    await expect(
      verifier.verify(admin.password, user.passwordHash),
    ).resolves.toBe(true);

    await expect(
      seed({ ...admin, password: 'second-pass-2026' }, true),
    ).resolves.toBe('password-reset');
    const [reset] = await prisma.user.findMany();
    await expect(
      verifier.verify('second-pass-2026', reset.passwordHash),
    ).resolves.toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses missing credentials with a clear message', async () => {
    await expect(seed({ email: admin.email })).rejects.toThrow(
      'set PLATFORM_ADMIN_PASSWORD',
    );
    await expect(seed({})).rejects.toThrow(
      'set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD',
    );
    expect(await prisma.user.count()).toBe(0);
  });

  it('enforces the password policy without echoing the password', async () => {
    const error = await seed({ ...admin, password: 'password123' }).catch(
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/password: Too common/);
    expect((error as Error).message).not.toContain('password123');
    expect(await prisma.user.count()).toBe(0);
  });
});
