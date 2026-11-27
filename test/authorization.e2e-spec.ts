import type { InMemoryMailTransport } from '@nestjs/mail';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type {
  AdminPrismaService,
  PrismaService,
} from '../src/shared/database/prisma.service.js';
import {
  createActiveUser,
  createTestApp,
  resetDatabase,
  testHasher,
  tokenFromMail,
} from './support/auth-app.js';

// Requires `docker compose up -d` (Postgres + Redis). Mail is captured in memory.
describe('Authorization (F03, e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  let mails: InMemoryMailTransport;
  const http = () => request(app.getHttpServer());

  const PASSWORD = 'correct horse battery';

  type Caller =
    | 'OWNER'
    | 'MANAGER'
    | 'RECEPTIONIST'
    | 'STAFF'
    | 'PLATFORM_ADMIN'
    | 'CUSTOMER';
  let tokens: Record<Caller, string>;
  let tenantId: string;
  let members: Record<'OWNER' | 'MANAGER' | 'RECEPTIONIST' | 'STAFF', string>;

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-authz-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.MEMBER_INVITE_LIMIT = '100';
    // The RBAC matrix sends well over the default 100 requests a minute.
    process.env.THROTTLE_LIMIT = '10000';
    ({ app, prisma, admin, mails } = await createTestApp());
  });

  afterAll(async () => {
    await resetDatabase(admin);
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await http()
      .post('/auth/staff/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function completeSetup(email: string) {
    const token = await tokenFromMail(mails, email);
    await http()
      .post('/auth/account-setup')
      .send({ token, password: PASSWORD })
      .expect(200);
    return login(email);
  }

  const as = (token: string) => ({
    get: (path: string) => http().get(path).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      http().post(path).auth(token, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).auth(token, { type: 'bearer' }).send(body),
  });

  /** A business with one member of each role, plus an admin and a customer. */
  beforeEach(async () => {
    await resetDatabase(admin);
    mails.clear();
    await createActiveUser(prisma, {
      email: 'admin@slotwise.local',
      password: PASSWORD,
      admin: true,
    });
    const adminToken = await login('admin@slotwise.local');
    const created = await as(adminToken)
      .post('/admin/tenants', {
        name: 'Glow Salon',
        slug: 'glow-salon',
        owner: { email: 'owner@glow.example', name: 'Asha' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    const ownerToken = await completeSetup('owner@glow.example');

    const add = async (role: string) => {
      const email = `${role.toLowerCase()}@glow.example`;
      const res = await as(ownerToken)
        .post('/members', { email, name: role, role })
        .expect(201);
      return {
        id: res.body.member.id as string,
        token: await completeSetup(email),
      };
    };
    const manager = await add('MANAGER');
    const desk = await add('RECEPTIONIST');
    const staff = await add('STAFF');
    const ownerId = (await as(ownerToken).get('/members').expect(200)).body
      .items[0].id as string;

    await prisma.customerAccount.create({
      data: {
        email: 'customer@example.com',
        passwordHash: await testHasher.hash(PASSWORD),
        emailVerifiedAt: new Date(),
      },
    });
    const customer = await http()
      .post('/auth/customer/login')
      .send({ email: 'customer@example.com', password: PASSWORD })
      .expect(200);

    tokens = {
      OWNER: ownerToken,
      MANAGER: manager.token,
      RECEPTIONIST: desk.token,
      STAFF: staff.token,
      PLATFORM_ADMIN: adminToken,
      CUSTOMER: customer.body.accessToken as string,
    };
    members = {
      OWNER: ownerId,
      MANAGER: manager.id,
      RECEPTIONIST: desk.id,
      STAFF: staff.id,
    };
  });

  it('the startup check sees every route and finds no problem', async () => {
    // Imported here: a static import would parse `env` before the overrides above.
    const { AuthorizationCoverageCheck } =
      await import('../src/modules/authorization/authorization-coverage.js');
    const check = app.get(AuthorizationCoverageCheck);
    const routes = check.routes();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining([
        'MeController.me',
        'MembersController.add',
        'AdminTenantsController.create',
        'OwnershipController.transfer',
      ]),
    );
    expect(() => check.onApplicationBootstrap()).not.toThrow();
  });

  describe('RBAC: the role alone decides', () => {
    const ok = (status: number) => status >= 200 && status < 300;
    const ALL: Caller[] = [
      'OWNER',
      'MANAGER',
      'RECEPTIONIST',
      'STAFF',
      'PLATFORM_ADMIN',
      'CUSTOMER',
    ];
    const endpoints: {
      name: string;
      call: (token: string) => request.Test;
      allowed: Caller[];
    }[] = [
      {
        name: 'GET /tenants/current',
        call: (t) => as(t).get('/tenants/current'),
        allowed: ['OWNER', 'MANAGER', 'RECEPTIONIST', 'STAFF'],
      },
      {
        name: 'PATCH /tenants/current',
        call: (t) => as(t).patch('/tenants/current', { city: 'Pune' }),
        allowed: ['OWNER', 'MANAGER'],
      },
      {
        name: 'GET /members',
        call: (t) => as(t).get('/members'),
        allowed: ['OWNER', 'MANAGER', 'RECEPTIONIST', 'STAFF'],
      },
      {
        name: 'GET /staff',
        call: (t) => as(t).get('/staff'),
        allowed: ['OWNER', 'MANAGER', 'RECEPTIONIST', 'STAFF'],
      },
      {
        name: 'GET /admin/tenants',
        call: (t) => as(t).get('/admin/tenants'),
        allowed: ['PLATFORM_ADMIN'],
      },
      {
        name: 'GET /admin/maintenance/schedules',
        call: (t) => as(t).get('/admin/maintenance/schedules'),
        allowed: ['PLATFORM_ADMIN'],
      },
    ];

    it.each(endpoints)('$name', async ({ call, allowed }) => {
      const results: Record<string, number> = {};
      for (const caller of ALL) {
        results[caller] = (await call(tokens[caller])).status;
      }
      for (const caller of ALL) {
        if (allowed.includes(caller)) {
          expect(ok(results[caller]), `${caller}: ${results[caller]}`).toBe(
            true,
          );
        } else {
          expect(results[caller], caller).toBe(403);
        }
      }
    });
  });

  describe('ABAC: member management by role rank (A8)', () => {
    it('Manager removes a Receptionist (204); not another Manager (403 ROLE_RANK_TOO_LOW)', async () => {
      const m2 = await as(tokens.OWNER)
        .post('/members', {
          email: 'm2@glow.example',
          name: 'M2',
          role: 'MANAGER',
        })
        .expect(201);
      const denied = await http()
        .delete(`/members/${m2.body.member.id}`)
        .auth(tokens.MANAGER, { type: 'bearer' })
        .expect(403);
      expect(denied.body.error.code).toBe('ROLE_RANK_TOO_LOW');
      await http()
        .delete(`/members/${members.RECEPTIONIST}`)
        .auth(tokens.MANAGER, { type: 'bearer' })
        .expect(204);
    });

    it('a removed member is refused on their next request', async () => {
      await as(tokens.STAFF).get('/staff').expect(200);
      await http()
        .delete(`/members/${members.STAFF}`)
        .auth(tokens.OWNER, { type: 'bearer' })
        .expect(204);
      const res = await as(tokens.STAFF).get('/staff').expect(403);
      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });
  });

  describe('ownership transfer', () => {
    const transfer = (token: string, body: object) =>
      as(token).post('/tenants/current/transfer-ownership', body);

    it('moves ownership to an active Manager in one audited step', async () => {
      const res = await transfer(tokens.OWNER, {
        memberId: members.MANAGER,
        password: PASSWORD,
      }).expect(200);
      expect(res.body.owner).toMatchObject({
        id: members.MANAGER,
        role: 'OWNER',
      });
      expect(res.body.previousOwner).toMatchObject({
        id: members.OWNER,
        role: 'MANAGER',
      });

      // Roles are read per request: the change applies at once.
      await transfer(tokens.OWNER, {
        memberId: members.MANAGER,
        password: PASSWORD,
      }).expect(403);
      const list = await as(tokens.MANAGER).get('/members').expect(200);
      expect(
        list.body.items.filter((m: { role: string }) => m.role === 'OWNER'),
      ).toEqual([expect.objectContaining({ id: members.MANAGER })]);

      const audit = await admin.auditLog.findMany({
        where: { tenantId, action: 'tenant.ownership_transferred' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        entityType: 'tenant',
        entityId: tenantId,
      });

      // And back again: the new Owner can transfer too.
      await transfer(tokens.MANAGER, {
        memberId: members.OWNER,
        password: PASSWORD,
      }).expect(200);
    });

    it('needs the Owner, their password, and an active Manager', async () => {
      for (const caller of ['MANAGER', 'RECEPTIONIST', 'STAFF'] as const) {
        await transfer(tokens[caller], {
          memberId: members.MANAGER,
          password: PASSWORD,
        }).expect(403);
      }
      const wrong = await transfer(tokens.OWNER, {
        memberId: members.MANAGER,
        password: 'not my password',
      }).expect(403);
      expect(wrong.body.error.code).toBe('REAUTHENTICATION_REQUIRED');

      const notManager = await transfer(tokens.OWNER, {
        memberId: members.RECEPTIONIST,
        password: PASSWORD,
      }).expect(422);
      expect(notManager.body.error.code).toBe('TRANSFER_TARGET_INVALID');

      const pending = await as(tokens.OWNER)
        .post('/members', {
          email: 'new@glow.example',
          name: 'New',
          role: 'MANAGER',
        })
        .expect(201);
      const notSetUp = await transfer(tokens.OWNER, {
        memberId: pending.body.member.id,
        password: PASSWORD,
      }).expect(422);
      expect(notSetUp.body.error.code).toBe('TRANSFER_TARGET_INVALID');

      await transfer(tokens.OWNER, {
        memberId: '0193a0a0-0000-7000-8000-00000000000f',
        password: PASSWORD,
      }).expect(404);
    });
  });
});
