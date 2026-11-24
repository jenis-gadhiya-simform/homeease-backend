import { PasswordHasher } from '@nestjs/authentication';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { RedisToken } from '@nestjs-redis/client';
import type { RedisClientType } from 'redis';
import type {
  AdminPrismaService,
  PrismaService,
} from '../../src/shared/database/prisma.service.js';

/** Cheap hashing for tests: the default cost is ~0.3 s and 128 MiB per hash. */
export const testHasher = new PasswordHasher({ logN: 10 });

export interface TestApp {
  app: NestExpressApplication;
  /** App role: row-level security applies. */
  prisma: PrismaService;
  /** BYPASSRLS: for test setup and cleanup across tenants. */
  admin: AdminPrismaService;
  mails: InMemoryMailTransport;
}

/**
 * The full AppModule with mail captured in memory and cheap password
 * hashing. Starts from an empty Redis test database, so rate-limit counters
 * left by another e2e file don't leak into this one.
 *
 * Set process.env overrides (QUEUE_PREFIX, AUTH_THROTTLE_LIMIT) before
 * calling: `env` is parsed when the app's modules are first imported.
 */
export async function createTestApp(): Promise<TestApp> {
  const { AppModule } = await import('../../src/modules/app/app.module.js');
  const { configureApp } = await import('../../src/config/app.setup.js');
  const { AdminPrismaService, PrismaService } =
    await import('../../src/shared/database/prisma.service.js');

  const mails = new InMemoryMailTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailTransport)
    .useValue(mails)
    .overrideProvider(PasswordHasher)
    .useValue(testHasher)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  // Redis logical db 1 only (the global setup refuses db 0).
  await app.get<RedisClientType>(RedisToken()).flushDb();
  return {
    app,
    prisma: app.get(PrismaService),
    admin: app.get(AdminPrismaService),
    mails,
  };
}

/**
 * Empties every app table (keeps the schema and migration history). Runs as
 * the admin role: the app role can't see tenant rows without a tenant.
 */
export async function resetDatabase(admin: AdminPrismaService) {
  const rows = await admin.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"${tablename}"`).join(', ');
  await admin.$executeRawUnsafe(`TRUNCATE ${tables} CASCADE`);
}

/** An ACTIVE staff user with a password. */
export async function createActiveUser(
  prisma: PrismaService,
  data: { email: string; password: string; name?: string; admin?: boolean },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? 'Test User',
      passwordHash: await testHasher.hash(data.password),
      status: 'ACTIVE',
      isPlatformAdmin: data.admin ?? false,
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });
}

/** The token query parameter of the first link in a captured email. */
export async function tokenFromMail(
  mails: InMemoryMailTransport,
  to: string,
  subject?: string,
): Promise<string> {
  const mail = await vi.waitFor(
    () => {
      const found = mails.find({ to, ...(subject && { subject }) });
      if (!found) throw new Error(`No email to ${to} yet`);
      return found;
    },
    { timeout: 5_000 },
  );
  const match = /[?&]token=([\w-]+)/.exec(String(mail.text));
  if (!match) throw new Error(`No token link in the email to ${to}`);
  return match[1];
}

/** The token query parameter of a link URL. */
export function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

/** The refresh cookie's value from a response's Set-Cookie. */
export function refreshCookie(res: {
  headers: Record<string, unknown>;
}): string | undefined {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = cookies.find((c) => c.startsWith('sw_refresh='));
  return cookie?.split(';')[0].slice('sw_refresh='.length) || undefined;
}

/** Decodes a JWT's payload (no verification: tests only). */
export function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
