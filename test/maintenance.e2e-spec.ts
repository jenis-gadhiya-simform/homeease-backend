import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { UnverifiedAccountsCleanupService as CleanupServiceType } from '../src/modules/auth/unverified-accounts-cleanup.service.js';
import type {
  AdminPrismaService,
  PrismaService,
} from '../src/shared/database/prisma.service.js';
import {
  createActiveUser,
  createTestApp,
  resetDatabase,
  testHasher,
} from './support/auth-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'correct horse battery';

// Requires `docker compose up -d` (Postgres + Redis). Uses a real BullMQ
// worker on its own queue prefix.
describe('Maintenance jobs (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  let cleanup: CleanupServiceType;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-maintenance-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    ({ app, prisma, admin } = await createTestApp());
    const { UnverifiedAccountsCleanupService } =
      await import('../src/modules/auth/unverified-accounts-cleanup.service.js');
    cleanup = app.get(UnverifiedAccountsCleanupService);
    // createTestApp() empties Redis after startup, which also removed the
    // schedules registered during it: register them again.
    const { MaintenanceScheduler } =
      await import('../src/modules/maintenance/maintenance.scheduler.js');
    await app.get(MaintenanceScheduler).onApplicationBootstrap();
  });

  afterAll(async () => {
    await resetDatabase(admin);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(admin);
  });

  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  /** One account of every kind; only `oldShell` is abandoned. */
  async function seedAccounts() {
    const create = (email: string, data: Record<string, unknown> = {}) =>
      prisma.customerAccount.create({
        data: { email, createdAt: daysAgo(10), ...data },
        select: { id: true, email: true },
      });

    const oldShell = await create('old-shell@example.com');
    await create('new-shell@example.com', { createdAt: daysAgo(1) });
    await create('verified@example.com', { emailVerifiedAt: daysAgo(9) });
    await create('password@example.com', {
      passwordHash: await testHasher.hash(PASSWORD),
    });
    const linked = await create('linked@example.com');
    await prisma.customerIdentity.create({
      data: {
        accountId: linked.id,
        provider: 'GOOGLE',
        subject: 'google-sub-linked',
      },
    });
    // Asked for a new magic link yesterday: still trying to sign in.
    const retrying = await create('retrying@example.com');
    await prisma.magicLinkToken.create({
      data: {
        accountId: retrying.id,
        tokenHash: 'a'.repeat(64),
        expiresAt: daysAgo(1),
        createdAt: daysAgo(1),
      },
    });
    // An old, expired, never-used link: goes with the account.
    await prisma.magicLinkToken.create({
      data: {
        accountId: oldShell.id,
        tokenHash: 'b'.repeat(64),
        expiresAt: daysAgo(10),
        createdAt: daysAgo(10),
      },
    });
    return { oldShell };
  }

  async function remainingEmails() {
    const rows = await prisma.customerAccount.findMany({
      select: { email: true },
      orderBy: { email: 'asc' },
    });
    return rows.map((row) => row.email);
  }

  it('deletes only accounts nobody verified or used, older than the retention', async () => {
    await seedAccounts();

    const result = await cleanup.purge(new Date(), 7);

    expect(result).toMatchObject({ deleted: 1, batches: 1, truncated: false });
    expect(await remainingEmails()).toEqual([
      'linked@example.com',
      'new-shell@example.com',
      'password@example.com',
      'retrying@example.com',
      'verified@example.com',
    ]);
    // Its expired magic link went with it (ON DELETE CASCADE).
    expect(await prisma.magicLinkToken.count()).toBe(1);

    // Idempotent: a second run (a retry) finds nothing.
    expect((await cleanup.purge(new Date(), 7)).deleted).toBe(0);
  });

  describe('admin API and the real worker', () => {
    async function adminToken() {
      await createActiveUser(prisma, {
        email: 'admin@slotwise.local',
        password: PASSWORD,
        admin: true,
      });
      const res = await http()
        .post('/auth/staff/login')
        .send({ email: 'admin@slotwise.local', password: PASSWORD })
        .expect(200);
      return res.body.accessToken as string;
    }

    it('lists the nightly schedule in IST with its next run', async () => {
      const token = await adminToken();

      const res = await http()
        .get('/admin/maintenance/schedules')
        .auth(token, { type: 'bearer' })
        .expect(200);

      expect(res.body).toEqual([
        {
          job: 'purge-unverified-customers',
          pattern: '0 3 * * *',
          timezone: 'Asia/Kolkata',
          nextRunAt: expect.stringMatching(/T21:30:00\.000Z$/), // 03:00 IST
        },
      ]);
      expect(new Date(res.body[0].nextRunAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('runs the purge on demand through the queue', async () => {
      const token = await adminToken();
      const { oldShell } = await seedAccounts();

      const started = await http()
        .post('/admin/maintenance/jobs/purge-unverified-customers/run')
        .auth(token, { type: 'bearer' })
        .expect(202);
      const jobId = started.body.jobId as string;
      expect(jobId).toMatch(/^purge-unverified-customers-manual-\d+$/);

      // The worker picks it up asynchronously: poll its state.
      const done = await vi.waitFor(
        async () => {
          const res = await http()
            .get(`/admin/maintenance/jobs/${jobId}`)
            .auth(token, { type: 'bearer' })
            .expect(200);
          if (res.body.state !== 'completed') {
            throw new Error(`still ${res.body.state}`);
          }
          return res.body;
        },
        { timeout: 10_000, interval: 100 },
      );

      expect(done).toMatchObject({
        job: 'purge-unverified-customers',
        state: 'completed',
        attemptsMade: expect.any(Number),
        result: { deleted: 1, batches: 1, truncated: false },
        failedReason: null,
      });
      expect(
        await prisma.customerAccount.findUnique({ where: { id: oldShell.id } }),
      ).toBeNull();
    });

    it('is for platform admins only, and validates the job name', async () => {
      const token = await adminToken();
      await http()
        .post('/admin/maintenance/jobs/drop-database/run')
        .auth(token, { type: 'bearer' })
        .expect(400);
      await http().get('/admin/maintenance/schedules').expect(401);

      await createActiveUser(prisma, {
        email: 'owner@glow.example',
        password: PASSWORD,
      });
      const staff = await http()
        .post('/auth/staff/login')
        .send({ email: 'owner@glow.example', password: PASSWORD })
        .expect(200);
      await http()
        .get('/admin/maintenance/schedules')
        .auth(staff.body.accessToken as string, { type: 'bearer' })
        .expect(403);
    });
  });
});
