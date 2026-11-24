import type { InMemoryMailTransport } from '@nestjs/mail';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type {
  AdminPrismaService,
  PrismaService,
} from '../src/shared/database/prisma.service.js';
import type { TenantPrismaService as TenantPrismaServiceType } from '../src/shared/database/tenant-prisma.service.js';
import {
  createActiveUser,
  createTestApp,
  resetDatabase,
  tokenFromMail,
} from './support/auth-app.js';

// Requires `docker compose up -d` (Postgres + Redis). Mail is captured in memory.
describe('Tenancy & onboarding (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  let tenantPrisma: TenantPrismaServiceType;
  let mails: InMemoryMailTransport;
  const http = () => request(app.getHttpServer());

  const PASSWORD = 'correct horse battery';
  const ADMIN_EMAIL = 'admin@slotwise.local';
  let adminToken: string;

  const glow = {
    name: 'Glow Salon',
    slug: 'glow-salon',
    phone: '+919876543210',
    city: 'Ahmedabad',
    owner: { email: 'owner@glow.example', name: 'Asha Patel' },
  };

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-tenancy-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    ({ app, prisma, admin, mails } = await createTestApp());
    const { TenantPrismaService } =
      await import('../src/shared/database/tenant-prisma.service.js');
    tenantPrisma = app.get(TenantPrismaService);
  });

  afterAll(async () => {
    await resetDatabase(admin);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(admin);
    mails.clear();
    await createActiveUser(prisma, {
      email: ADMIN_EMAIL,
      password: PASSWORD,
      admin: true,
      name: 'Platform Admin',
    });
    adminToken = await login(ADMIN_EMAIL, PASSWORD);
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await http()
      .post('/auth/staff/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  const createTenant = (body: object, token = adminToken) =>
    http().post('/admin/tenants').auth(token, { type: 'bearer' }).send(body);

  /** Admin creates the business; the Owner sets a password from the email. */
  async function onboard(input = glow) {
    const res = await createTenant(input).expect(201);
    const token = await tokenFromMail(mails, input.owner.email);
    await http()
      .post('/auth/account-setup')
      .send({ token, password: PASSWORD })
      .expect(200);
    const ownerToken = await login(input.owner.email, PASSWORD);
    return { tenantId: res.body.tenant.id as string, ownerToken };
  }

  describe('onboarding', () => {
    it('admin creates the business + Owner; the Owner sets a password and sees the business', async () => {
      const res = await createTenant(glow).expect(201);
      expect(res.body).toEqual({
        tenant: {
          id: expect.any(String),
          slug: 'glow-salon',
          name: 'Glow Salon',
          phone: '+919876543210',
          city: 'Ahmedabad',
          address: null,
          status: 'ACTIVE',
          createdAt: expect.stringMatching(/Z$/),
        },
        owner: {
          id: expect.any(String),
          email: 'owner@glow.example',
          name: 'Asha Patel',
          status: 'PENDING_SETUP',
        },
      });

      // The setup email, after commit.
      const token = await tokenFromMail(
        mails,
        'owner@glow.example',
        'Set your password for Glow Salon',
      );
      const info = await http().get(`/auth/account-setup/${token}`).expect(200);
      expect(info.body).toEqual({
        email: 'owner@glow.example',
        name: 'Asha Patel',
        businessName: 'Glow Salon',
      });

      const setup = await http()
        .post('/auth/account-setup')
        .send({ token, password: PASSWORD })
        .expect(200);

      const current = await http()
        .get('/tenants/current')
        .auth(setup.body.accessToken, { type: 'bearer' })
        .expect(200);
      expect(current.body).toMatchObject({
        id: res.body.tenant.id,
        name: 'Glow Salon',
        slug: 'glow-salon',
      });

      // The admin never had the password; the account is the Owner's own.
      const owner = await admin.user.findUniqueOrThrow({
        where: { email: 'owner@glow.example' },
      });
      expect(owner.status).toBe('ACTIVE');
      expect(owner.isPlatformAdmin).toBe(false);
    });

    it('audits tenant.created and membership.created as the platform admin', async () => {
      const res = await createTenant(glow).expect(201);
      const entries = await admin.auditLog.findMany({
        where: { tenantId: res.body.tenant.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual([
        'tenant.created',
        'membership.created',
      ]);
      for (const entry of entries) {
        expect(entry.actorType).toBe('PLATFORM_ADMIN');
        expect(entry.actorRole).toBe('PLATFORM_ADMIN');
        expect(entry.requestId).toEqual(expect.any(String));
      }
    });

    it('answers 409 SLUG_TAKEN on a duplicate slug and creates nothing', async () => {
      await createTenant(glow).expect(201);
      const users = await admin.user.count();
      const memberships = await admin.membership.count();
      mails.clear();

      const res = await createTenant({
        ...glow,
        name: 'Other Glow',
        owner: { email: 'someone@else.example', name: 'Ravi' },
      }).expect(409);
      expect(res.body.error.code).toBe('SLUG_TAKEN');

      expect(await admin.user.count()).toBe(users);
      expect(await admin.membership.count()).toBe(memberships);
      expect(await admin.tenant.count()).toBe(1);
      expect(
        await admin.user.findUnique({
          where: { email: 'someone@else.example' },
        }),
      ).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mails.find({ to: 'someone@else.example' })).toBeUndefined();
    });

    it.each([
      [{ slug: 'admin' }, 'reserved slug'],
      [{ slug: 'Glow Salon' }, 'uppercase and space'],
      [{ slug: 'ab' }, 'too short'],
      [{ phone: '9876543210' }, 'phone not E.164'],
      [{ timezone: 'Asia/Kolkata' }, 'unknown field is ignored'],
    ])('validates the body (%j: %s)', async (patch, why) => {
      const res = await createTenant({ ...glow, ...patch });
      if (why.includes('ignored')) {
        expect(res.status).toBe(201);
        expect(res.body.tenant).not.toHaveProperty('timezone');
      } else {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses a platform admin email as Owner (422)', async () => {
      const res = await createTenant({
        ...glow,
        owner: { email: ADMIN_EMAIL, name: 'Admin' },
      }).expect(422);
      expect(res.body.error.code).toBe('OWNER_IS_PLATFORM_ADMIN');
      expect(await admin.tenant.count()).toBe(0);
    });

    it('adds an existing staff user as Owner of a second business without a new user or link', async () => {
      const { ownerToken } = await onboard();
      mails.clear();

      const second = await createTenant({
        name: 'Glow Spa',
        slug: 'glow-spa',
        owner: { email: 'owner@glow.example', name: 'ignored' },
      }).expect(201);
      expect(second.body.owner).toMatchObject({
        email: 'owner@glow.example',
        name: 'Asha Patel',
        status: 'ACTIVE',
      });
      expect(
        await admin.user.count({ where: { email: 'owner@glow.example' } }),
      ).toBe(1);

      await vi.waitFor(
        () =>
          mails.assertSent({
            to: 'owner@glow.example',
            subject: "You're now the Owner of Glow Spa",
          }),
        { timeout: 5_000 },
      );
      const owner = await admin.user.findUniqueOrThrow({
        where: { email: 'owner@glow.example' },
        select: { id: true },
      });
      expect(
        await admin.accountSetupToken.count({
          where: { userId: owner.id, usedAt: null },
        }),
      ).toBe(0);

      // Two businesses: the request must say which one.
      const ambiguous = await http()
        .get('/tenants/current')
        .auth(ownerToken, { type: 'bearer' })
        .expect(400);
      expect(ambiguous.body.error.code).toBe('TENANT_REQUIRED');
      const spa = await http()
        .get('/tenants/current')
        .auth(ownerToken, { type: 'bearer' })
        .set('X-Tenant-Id', second.body.tenant.id)
        .expect(200);
      expect(spa.body.name).toBe('Glow Spa');
    });
  });

  describe('who may onboard', () => {
    it('rejects Owners, customers and anonymous callers', async () => {
      const { ownerToken } = await onboard();
      const asOwner = await createTenant(
        { ...glow, slug: 'owner-made' },
        ownerToken,
      ).expect(403);
      expect(asOwner.body.error.code).toBe('FORBIDDEN');

      await http()
        .post('/auth/customer/magic-link')
        .send({ email: 'cust@example.com' })
        .expect(202);
      const magic = await tokenFromMail(mails, 'cust@example.com');
      const customer = await http()
        .post('/auth/customer/magic-link/verify')
        .send({ token: magic })
        .expect(200);
      await createTenant(
        { ...glow, slug: 'customer-made' },
        customer.body.accessToken,
      ).expect(403);

      await http().post('/admin/tenants').send(glow).expect(401);
      await http()
        .get('/admin/tenants')
        .auth(ownerToken, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('setup links', () => {
    it('resend-setup issues a working link and the old one stops working', async () => {
      const res = await createTenant(glow).expect(201);
      const first = await tokenFromMail(mails, 'owner@glow.example');
      mails.clear();

      await http()
        .post(`/admin/tenants/${res.body.tenant.id}/owner/resend-setup`)
        .auth(adminToken, { type: 'bearer' })
        .expect(202);
      const second = await tokenFromMail(mails, 'owner@glow.example');
      expect(second).not.toBe(first);

      await http()
        .post('/auth/account-setup')
        .send({ token: first, password: PASSWORD })
        .expect(410);
      await http()
        .post('/auth/account-setup')
        .send({ token: second, password: PASSWORD })
        .expect(200);
      // Used twice → 410.
      await http()
        .post('/auth/account-setup')
        .send({ token: second, password: PASSWORD })
        .expect(410);

      // Set up: no more resends.
      const again = await http()
        .post(`/admin/tenants/${res.body.tenant.id}/owner/resend-setup`)
        .auth(adminToken, { type: 'bearer' })
        .expect(409);
      expect(again.body.error.code).toBe('OWNER_ALREADY_ACTIVE');
    });

    it('answers 410 for an expired setup link', async () => {
      await createTenant(glow).expect(201);
      const token = await tokenFromMail(mails, 'owner@glow.example');
      await admin.accountSetupToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await http()
        .post('/auth/account-setup')
        .send({ token, password: PASSWORD })
        .expect(410);
    });

    it('replaces a pending Owner; the old link dies and the old user is disabled', async () => {
      const res = await createTenant({
        ...glow,
        owner: { email: 'typo@glow.example', name: 'Asha Patel' },
      }).expect(201);
      const oldLink = await tokenFromMail(mails, 'typo@glow.example');
      const tenantId = res.body.tenant.id as string;

      const replaced = await http()
        .put(`/admin/tenants/${tenantId}/owner`)
        .auth(adminToken, { type: 'bearer' })
        .send({ email: 'owner@glow.example', name: 'Asha Patel' })
        .expect(200);
      expect(replaced.body.owner).toMatchObject({
        email: 'owner@glow.example',
        status: 'PENDING_SETUP',
      });

      await http()
        .post('/auth/account-setup')
        .send({ token: oldLink, password: PASSWORD })
        .expect(410);
      const typo = await admin.user.findUniqueOrThrow({
        where: { email: 'typo@glow.example' },
      });
      expect(typo.status).toBe('DISABLED');

      const newLink = await tokenFromMail(mails, 'owner@glow.example');
      await http()
        .post('/auth/account-setup')
        .send({ token: newLink, password: PASSWORD })
        .expect(200);

      const detail = await http()
        .get(`/admin/tenants/${tenantId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);
      expect(detail.body.owner).toMatchObject({
        email: 'owner@glow.example',
        status: 'ACTIVE',
      });

      // Active Owner: only ownership transfer (F03) can change it.
      await http()
        .put(`/admin/tenants/${tenantId}/owner`)
        .auth(adminToken, { type: 'bearer' })
        .send({ email: 'third@glow.example', name: 'X' })
        .expect(409);
    });
  });

  describe('admin listing', () => {
    it('lists businesses newest first with a cursor', async () => {
      for (const slug of ['first-biz', 'second-biz', 'third-biz']) {
        await createTenant({
          name: slug,
          slug,
          owner: { email: `${slug}@x.example`, name: 'O' },
        }).expect(201);
      }
      const page1 = await http()
        .get('/admin/tenants?limit=2')
        .auth(adminToken, { type: 'bearer' })
        .expect(200);
      expect(page1.body.items.map((t: { slug: string }) => t.slug)).toEqual([
        'third-biz',
        'second-biz',
      ]);
      const page2 = await http()
        .get(`/admin/tenants?limit=2&cursor=${page1.body.nextCursor}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);
      expect(page2.body.items.map((t: { slug: string }) => t.slug)).toEqual([
        'first-biz',
      ]);
      expect(page2.body.nextCursor).toBeNull();
    });
  });

  describe('business profile', () => {
    it('Owner updates the profile, audited with before/after; no timezone/currency fields', async () => {
      const { tenantId, ownerToken } = await onboard();
      const res = await http()
        .patch('/tenants/current')
        .auth(ownerToken, { type: 'bearer' })
        .send({ name: 'Glow Salon & Spa', address: '12 CG Road' })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Glow Salon & Spa',
        address: '12 CG Road',
      });

      const entry = await admin.auditLog.findFirstOrThrow({
        where: { tenantId, action: 'tenant.updated' },
      });
      expect(entry.before).toEqual({ name: 'Glow Salon', address: null });
      expect(entry.after).toEqual({
        name: 'Glow Salon & Spa',
        address: '12 CG Road',
      });
      expect(entry.actorType).toBe('USER');
      expect(entry.actorRole).toBe('OWNER');

      await http()
        .patch('/tenants/current')
        .auth(ownerToken, { type: 'bearer' })
        .send({ timezone: 'Asia/Kolkata' })
        .expect(400);
    });

    it('lets any member read it but only Owner/Manager update it', async () => {
      const { tenantId } = await onboard();
      const staff = await createActiveUser(prisma, {
        email: 'staff@glow.example',
        password: PASSWORD,
      });
      const manager = await createActiveUser(prisma, {
        email: 'manager@glow.example',
        password: PASSWORD,
      });
      await admin.membership.createMany({
        data: [
          { tenantId, userId: staff.id, role: 'STAFF' },
          { tenantId, userId: manager.id, role: 'MANAGER' },
        ],
      });
      const staffToken = await login('staff@glow.example', PASSWORD);
      const managerToken = await login('manager@glow.example', PASSWORD);

      await http()
        .get('/tenants/current')
        .auth(staffToken, { type: 'bearer' })
        .expect(200);
      await http()
        .patch('/tenants/current')
        .auth(staffToken, { type: 'bearer' })
        .send({ city: 'Surat' })
        .expect(403);
      await http()
        .patch('/tenants/current')
        .auth(managerToken, { type: 'bearer' })
        .send({ city: 'Surat' })
        .expect(200);
    });

    it('serves the public profile by slug', async () => {
      await createTenant(glow).expect(201);
      const res = await http().get('/public/glow-salon').expect(200);
      expect(res.body).toEqual({
        slug: 'glow-salon',
        name: 'Glow Salon',
        phone: '+919876543210',
        city: 'Ahmedabad',
        address: null,
        staff: [],
      });
      await http().get('/public/no-such-biz').expect(404);
    });

    it('suspended business: public page 404, staff API 403 TENANT_SUSPENDED', async () => {
      const { tenantId, ownerToken } = await onboard();
      await admin.tenant.update({
        where: { id: tenantId },
        data: { status: 'SUSPENDED' },
      });

      await http().get('/public/glow-salon').expect(404);
      const res = await http()
        .get('/tenants/current')
        .auth(ownerToken, { type: 'bearer' })
        .expect(403);
      expect(res.body.error.code).toBe('TENANT_SUSPENDED');
    });
  });

  describe('isolation', () => {
    async function twoBusinesses() {
      const a = await onboard();
      const b = await onboard({
        name: 'Calm Clinic',
        slug: 'calm-clinic',
        phone: '+919812345678',
        city: 'Surat',
        owner: { email: 'owner@calm.example', name: 'Dev Shah' },
      });
      return { a, b };
    }

    it("a member of A can't act in B, even by sending B's id", async () => {
      const { a, b } = await twoBusinesses();
      const res = await http()
        .get('/tenants/current')
        .auth(a.ownerToken, { type: 'bearer' })
        .set('X-Tenant-Id', b.tenantId)
        .expect(403);
      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });

    it('RLS: the app role sees zero tenant rows without app.tenant_id', async () => {
      await twoBusinesses();
      expect(await admin.membership.count()).toBe(2);

      // Raw SQL through the app role, no tenant set: the policy hides everything.
      const raw = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM membership`;
      expect(Number(raw[0].count)).toBe(0);
      expect(await prisma.membership.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it("RLS: inside tenant A, B's rows don't exist (a foreign id finds nothing)", async () => {
      const { a, b } = await twoBusinesses();
      const bMembership = await admin.membership.findFirstOrThrow({
        where: { tenantId: b.tenantId },
      });

      await tenantPrisma.run(a.tenantId, async (tx) => {
        // Even a query that forgets `tenantId` only sees A.
        const visible = await tx.membership.findMany({
          select: { tenantId: true },
        });
        expect(visible.map((m) => m.tenantId)).toEqual([a.tenantId]);
        expect(
          await tx.membership.findUnique({ where: { id: bMembership.id } }),
        ).toBeNull();
      });
    });

    it("RLS: tenant A can't write a row into tenant B", async () => {
      const { a, b } = await twoBusinesses();
      const user = await createActiveUser(prisma, {
        email: 'intruder@x.example',
        password: PASSWORD,
      });
      await expect(
        tenantPrisma.run(a.tenantId, (tx) =>
          tx.membership.create({
            data: { tenantId: b.tenantId, userId: user.id, role: 'STAFF' },
          }),
        ),
      ).rejects.toThrow(/row-level security|policy/i);
    });

    it('the audit log is append-only for the app role', async () => {
      const { a } = await twoBusinesses();
      await expect(
        tenantPrisma.run(a.tenantId, (tx) =>
          tx.auditLog.updateMany({ data: { reason: 'tampered' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
