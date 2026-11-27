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
  tokenFromMail,
} from './support/auth-app.js';

const INVITE_LIMIT = 8;

// Requires `docker compose up -d` (Postgres + Redis). Mail is captured in memory.
describe('Team members & staff (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  let mails: InMemoryMailTransport;
  const http = () => request(app.getHttpServer());

  const PASSWORD = 'correct horse battery';
  const ADMIN_EMAIL = 'admin@slotwise.local';
  let adminToken: string;

  const glow = {
    name: 'Glow Salon',
    slug: 'glow-salon',
    owner: { email: 'owner@glow.example', name: 'Asha Patel' },
  };
  const urban = {
    name: 'Urban Cuts',
    slug: 'urban-cuts',
    owner: { email: 'owner@urban.example', name: 'Ravi Shah' },
  };

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-team-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.MEMBER_INVITE_LIMIT = String(INVITE_LIMIT);
    ({ app, prisma, admin, mails } = await createTestApp());
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

  async function login(email: string, password = PASSWORD): Promise<string> {
    const res = await http()
      .post('/auth/staff/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  /** Opens the newest setup link sent to `email`, sets a password, signs in. */
  async function completeSetup(email: string, subject?: string) {
    const token = await tokenFromMail(mails, email, subject);
    await http()
      .post('/auth/account-setup')
      .send({ token, password: PASSWORD })
      .expect(200);
    return login(email);
  }

  /** Platform admin creates the business; the Owner sets a password. */
  async function onboard(input = glow) {
    const res = await http()
      .post('/admin/tenants')
      .auth(adminToken, { type: 'bearer' })
      .send(input)
      .expect(201);
    const ownerToken = await completeSetup(input.owner.email);
    return { tenantId: res.body.tenant.id as string, ownerToken };
  }

  const as = (token: string, tenantId?: string) => {
    const withAuth = <T extends request.Test>(req: T) => {
      req.auth(token, { type: 'bearer' });
      if (tenantId) req.set('X-Tenant-Id', tenantId);
      return req;
    };
    return {
      get: (path: string) => withAuth(http().get(path)),
      post: (path: string, body: object = {}) =>
        withAuth(http().post(path).send(body)),
      patch: (path: string, body: object) =>
        withAuth(http().patch(path).send(body)),
      delete: (path: string) => withAuth(http().delete(path)),
    };
  };

  /** Adds a member and has them finish setup; returns their member id and token. */
  async function addActiveMember(
    actorToken: string,
    body: { email: string; name: string; role: string; bookable?: boolean },
  ) {
    const res = await as(actorToken).post('/members', body).expect(201);
    const token = await completeSetup(body.email);
    return { id: res.body.member.id as string, token, member: res.body.member };
  }

  async function waitForMails(to: string, count: number) {
    return vi.waitFor(
      () => {
        const found = mails.filter({ to });
        if (found.length < count) throw new Error(`Waiting for mail to ${to}`);
        return found;
      },
      { timeout: 5_000 },
    );
  }

  it('full chain: Owner builds the team, each member sets a password and sees their role', async () => {
    const { tenantId, ownerToken } = await onboard();
    const team = [
      { email: 'manager@glow.example', name: 'Neha Iyer', role: 'MANAGER' },
      { email: 'desk@glow.example', name: 'Kabir Das', role: 'RECEPTIONIST' },
      { email: 'maya@glow.example', name: 'Maya Rao', role: 'STAFF' },
    ];

    for (const person of team) {
      const res = await as(ownerToken).post('/members', person).expect(201);
      expect(res.body.member).toEqual({
        id: expect.any(String),
        userId: expect.any(String),
        email: person.email,
        name: person.name,
        role: person.role,
        staffId: person.role === 'STAFF' ? expect.any(String) : null,
        bookable: person.role === 'STAFF',
        status: 'PENDING_SETUP',
        createdAt: expect.stringMatching(/Z$/),
      });

      const token = await completeSetup(
        person.email,
        'Join Glow Salon on SlotWise',
      );
      const me = await as(token).get('/me').expect(200);
      expect(me.body.memberships).toEqual([
        {
          tenantId,
          tenantName: 'Glow Salon',
          tenantSlug: 'glow-salon',
          tenantStatus: 'ACTIVE',
          role: person.role,
          staffId: res.body.member.staffId,
        },
      ]);
      await as(token).get('/tenants/current').expect(200);
    }

    const list = await as(ownerToken).get('/members').expect(200);
    expect(
      list.body.items.map((m: { role: string; status: string }) => [
        m.role,
        m.status,
      ]),
    ).toEqual([
      ['OWNER', 'ACTIVE'],
      ['MANAGER', 'ACTIVE'],
      ['RECEPTIONIST', 'ACTIVE'],
      ['STAFF', 'ACTIVE'],
    ]);

    const audit = await admin.auditLog.findMany({
      where: { tenantId, action: 'membership.created', actorRole: 'OWNER' },
    });
    expect(audit).toHaveLength(3);
  });

  describe('who can add whom', () => {
    it('Manager adds Receptionist and Staff, but not a Manager (403)', async () => {
      const { ownerToken } = await onboard();
      const manager = await addActiveMember(ownerToken, {
        email: 'manager@glow.example',
        name: 'Neha',
        role: 'MANAGER',
      });

      await as(manager.token)
        .post('/members', {
          email: 'desk@glow.example',
          name: 'Kabir',
          role: 'RECEPTIONIST',
        })
        .expect(201);
      await as(manager.token)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya',
          role: 'STAFF',
        })
        .expect(201);
      const res = await as(manager.token)
        .post('/members', {
          email: 'm2@glow.example',
          name: 'Other',
          role: 'MANAGER',
        })
        .expect(403);
      expect(res.body.error.code).toBe('ROLE_RANK_TOO_LOW');
    });

    it('Receptionist and Staff cannot add anyone (403), but can read the team', async () => {
      const { ownerToken } = await onboard();
      for (const role of ['RECEPTIONIST', 'STAFF']) {
        const member = await addActiveMember(ownerToken, {
          email: `${role.toLowerCase()}@glow.example`,
          name: role,
          role,
        });
        const res = await as(member.token)
          .post('/members', {
            email: 'x@glow.example',
            name: 'X',
            role: 'STAFF',
          })
          .expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        // F03: every member reads the team (RBAC, any member role).
        await as(member.token).get('/members').expect(200);
      }
    });

    it('nobody adds an OWNER via /members (422)', async () => {
      const { ownerToken } = await onboard();
      const manager = await addActiveMember(ownerToken, {
        email: 'manager@glow.example',
        name: 'Neha',
        role: 'MANAGER',
      });
      for (const token of [ownerToken, manager.token]) {
        const res = await as(token)
          .post('/members', {
            email: 'new-owner@glow.example',
            name: 'X',
            role: 'OWNER',
          })
          .expect(422);
        expect(res.body.error.code).toBe('OWNERSHIP_TRANSFER_REQUIRED');
      }
    });

    it('refuses the platform admin email (422) and STAFF without a calendar (422)', async () => {
      const { ownerToken } = await onboard();
      const res = await as(ownerToken)
        .post('/members', { email: ADMIN_EMAIL, name: 'PA', role: 'STAFF' })
        .expect(422);
      expect(res.body.error.code).toBe('MEMBER_IS_PLATFORM_ADMIN');

      const staff = await as(ownerToken)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya',
          role: 'STAFF',
          bookable: false,
        })
        .expect(422);
      expect(staff.body.error.code).toBe('STAFF_MUST_BE_BOOKABLE');
    });
  });

  describe('adding existing people', () => {
    it('answers 409 ALREADY_MEMBER for an email that is already a member', async () => {
      const { ownerToken } = await onboard();
      const body = { email: 'maya@glow.example', name: 'Maya', role: 'STAFF' };
      await as(ownerToken).post('/members', body).expect(201);
      const res = await as(ownerToken)
        .post('/members', { ...body, email: 'MAYA@glow.example' })
        .expect(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
      const ownerAgain = await as(ownerToken)
        .post('/members', {
          email: glow.owner.email,
          name: 'Asha',
          role: 'MANAGER',
        })
        .expect(409);
      expect(ownerAgain.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('adds a user who works at another business without a setup email', async () => {
      const glowTeam = await onboard();
      const urbanTeam = await onboard(urban);
      const maya = await addActiveMember(glowTeam.ownerToken, {
        email: 'maya@glow.example',
        name: 'Maya Rao',
        role: 'STAFF',
      });
      mails.clear();

      const res = await as(urbanTeam.ownerToken)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya R.',
          role: 'RECEPTIONIST',
          bookable: true,
        })
        .expect(201);
      expect(res.body.member).toMatchObject({
        userId: maya.member.userId,
        name: 'Maya Rao',
        role: 'RECEPTIONIST',
        bookable: true,
        status: 'ACTIVE',
      });

      const [mail] = await waitForMails('maya@glow.example', 1);
      expect(mail.subject).toBe("You've been added to Urban Cuts");
      expect(String(mail.text)).not.toMatch(/token=/);

      // Both businesses work, each with its own role and calendar name.
      const me = await as(maya.token).get('/me').expect(200);
      expect(
        me.body.memberships.map((m: { tenantSlug: string; role: string }) => [
          m.tenantSlug,
          m.role,
        ]),
      ).toEqual([
        ['glow-salon', 'STAFF'],
        ['urban-cuts', 'RECEPTIONIST'],
      ]);
      const publicUrban = await http().get('/public/urban-cuts').expect(200);
      expect(publicUrban.body.staff).toEqual([
        { id: res.body.member.staffId, displayName: 'Maya R.' },
      ]);
    });
  });

  describe('removing members', () => {
    it("ends the member's access on their next request; other businesses still work", async () => {
      const glowTeam = await onboard();
      const urbanTeam = await onboard(urban);
      const maya = await addActiveMember(glowTeam.ownerToken, {
        email: 'maya@glow.example',
        name: 'Maya',
        role: 'STAFF',
      });
      await as(urbanTeam.ownerToken)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya',
          role: 'STAFF',
        })
        .expect(201);
      await as(maya.token, glowTeam.tenantId).get('/staff').expect(200);
      expect(
        (await http().get('/public/glow-salon').expect(200)).body.staff,
      ).toHaveLength(1);

      await as(glowTeam.ownerToken).delete(`/members/${maya.id}`).expect(204);

      const res = await as(maya.token, glowTeam.tenantId)
        .get('/staff')
        .expect(403);
      expect(res.body.error.code).toBe('NOT_A_MEMBER');
      await as(maya.token, urbanTeam.tenantId).get('/staff').expect(200);
      // Now only in Urban Cuts: no header needed.
      await as(maya.token).get('/tenants/current').expect(200);

      // Calendar deactivated and gone from the public page; user kept.
      expect(
        (await http().get('/public/glow-salon').expect(200)).body.staff,
      ).toEqual([]);
      const removed = await as(glowTeam.ownerToken)
        .get('/members?status=REMOVED')
        .expect(200);
      expect(removed.body.items).toEqual([
        expect.objectContaining({
          id: maya.id,
          status: 'REMOVED',
          bookable: false,
        }),
      ]);
      const audit = await admin.auditLog.findFirstOrThrow({
        where: { action: 'membership.removed', entityId: maya.id },
      });
      expect(audit.before).toEqual({ role: 'STAFF', status: 'ACTIVE' });
      expect(audit.after).toEqual({ status: 'REMOVED' });

      // Removing again is a 404.
      await as(glowTeam.ownerToken).delete(`/members/${maya.id}`).expect(404);
    });

    it('re-adding a removed member reactivates the membership and calendar', async () => {
      const { ownerToken } = await onboard();
      const maya = await addActiveMember(ownerToken, {
        email: 'maya@glow.example',
        name: 'Maya',
        role: 'STAFF',
      });
      await as(ownerToken).delete(`/members/${maya.id}`).expect(204);

      const res = await as(ownerToken)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya',
          role: 'STAFF',
        })
        .expect(201);
      expect(res.body.member).toMatchObject({
        id: maya.id,
        staffId: maya.member.staffId,
        bookable: true,
        status: 'ACTIVE',
      });
      await as(maya.token).get('/staff').expect(200);
    });

    it('the Owner cannot remove or demote themself; a Manager cannot remove a Manager', async () => {
      const { ownerToken } = await onboard();
      const list = await as(ownerToken).get('/members').expect(200);
      const ownerId = list.body.items[0].id as string;

      const remove = await as(ownerToken)
        .delete(`/members/${ownerId}`)
        .expect(422);
      expect(remove.body.error.code).toBe('OWNERSHIP_TRANSFER_REQUIRED');
      const demote = await as(ownerToken)
        .patch(`/members/${ownerId}`, { role: 'MANAGER' })
        .expect(422);
      expect(demote.body.error.code).toBe('OWNERSHIP_TRANSFER_REQUIRED');

      const m1 = await addActiveMember(ownerToken, {
        email: 'm1@glow.example',
        name: 'M1',
        role: 'MANAGER',
      });
      const m2 = await addActiveMember(ownerToken, {
        email: 'm2@glow.example',
        name: 'M2',
        role: 'MANAGER',
      });
      await as(m1.token).delete(`/members/${m2.id}`).expect(403);
      await as(m1.token).delete(`/members/${ownerId}`).expect(422);
    });
  });

  describe('changing members', () => {
    it('changes role and bookable, audited with before/after', async () => {
      const { tenantId, ownerToken } = await onboard();
      const res = await as(ownerToken)
        .post('/members', {
          email: 'desk@glow.example',
          name: 'Kabir',
          role: 'RECEPTIONIST',
        })
        .expect(201);
      const id = res.body.member.id as string;
      expect(res.body.member.bookable).toBe(false);

      const promoted = await as(ownerToken)
        .patch(`/members/${id}`, { role: 'STAFF' })
        .expect(200);
      expect(promoted.body.member).toMatchObject({
        role: 'STAFF',
        bookable: true,
        staffId: expect.any(String),
      });
      const notBookable = await as(ownerToken)
        .patch(`/members/${id}`, { bookable: false })
        .expect(422);
      expect(notBookable.body.error.code).toBe('STAFF_MUST_BE_BOOKABLE');

      const back = await as(ownerToken)
        .patch(`/members/${id}`, { role: 'RECEPTIONIST', bookable: false })
        .expect(200);
      expect(back.body.member).toMatchObject({
        role: 'RECEPTIONIST',
        bookable: false,
        staffId: promoted.body.member.staffId,
      });

      const toOwner = await as(ownerToken)
        .patch(`/members/${id}`, { role: 'OWNER' })
        .expect(422);
      expect(toOwner.body.error.code).toBe('OWNERSHIP_TRANSFER_REQUIRED');

      const audit = await admin.auditLog.findMany({
        where: { tenantId, action: 'membership.updated', entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => [a.before, a.after])).toEqual([
        [
          { role: 'RECEPTIONIST', bookable: false },
          {
            role: 'STAFF',
            bookable: true,
            staffId: promoted.body.member.staffId,
          },
        ],
        [
          { role: 'STAFF', bookable: true },
          {
            role: 'RECEPTIONIST',
            bookable: false,
            staffId: promoted.body.member.staffId,
          },
        ],
      ]);
    });

    it('the Owner can make themself bookable; a Manager cannot promote to Manager', async () => {
      const { ownerToken } = await onboard();
      const list = await as(ownerToken).get('/members').expect(200);
      const ownerId = list.body.items[0].id as string;
      const res = await as(ownerToken)
        .patch(`/members/${ownerId}`, { bookable: true })
        .expect(200);
      expect(res.body.member).toMatchObject({ role: 'OWNER', bookable: true });

      const manager = await addActiveMember(ownerToken, {
        email: 'manager@glow.example',
        name: 'Neha',
        role: 'MANAGER',
      });
      const desk = await as(manager.token)
        .post('/members', {
          email: 'desk@glow.example',
          name: 'Kabir',
          role: 'RECEPTIONIST',
        })
        .expect(201);
      await as(manager.token)
        .patch(`/members/${desk.body.member.id}`, { role: 'MANAGER' })
        .expect(403);
      await as(manager.token)
        .patch(`/members/${ownerId}`, { bookable: false })
        .expect(403);
    });

    it("another business's member id is a 404", async () => {
      const glowTeam = await onboard();
      const urbanTeam = await onboard(urban);
      const res = await as(urbanTeam.ownerToken)
        .post('/members', {
          email: 'u@urban.example',
          name: 'U',
          role: 'STAFF',
        })
        .expect(201);
      await as(glowTeam.ownerToken)
        .patch(`/members/${res.body.member.id}`, { role: 'RECEPTIONIST' })
        .expect(404);
      await as(glowTeam.ownerToken)
        .delete(`/members/${res.body.member.id}`)
        .expect(404);
    });
  });

  describe('resend setup', () => {
    it('sends a new link and kills the old one; 409 once active', async () => {
      const { ownerToken } = await onboard();
      const res = await as(ownerToken)
        .post('/members', {
          email: 'maya@glow.example',
          name: 'Maya',
          role: 'STAFF',
        })
        .expect(201);
      const id = res.body.member.id as string;
      const oldToken = await tokenFromMail(mails, 'maya@glow.example');

      await as(ownerToken).post(`/members/${id}/resend-setup`).expect(202);
      await waitForMails('maya@glow.example', 2);
      const newToken = await tokenFromMail(mails, 'maya@glow.example');
      expect(newToken).not.toBe(oldToken);

      const dead = await http()
        .post('/auth/account-setup')
        .send({ token: oldToken, password: PASSWORD })
        .expect(410);
      expect(dead.body.error.code).toBe('LINK_EXPIRED');
      await http()
        .post('/auth/account-setup')
        .send({ token: newToken, password: PASSWORD })
        .expect(200);

      const again = await as(ownerToken)
        .post(`/members/${id}/resend-setup`)
        .expect(409);
      expect(again.body.error.code).toBe('MEMBER_ALREADY_ACTIVE');
    });

    it(`limits invitations to MEMBER_INVITE_LIMIT (${INVITE_LIMIT}) per business per hour`, async () => {
      const glowTeam = await onboard();
      const urbanTeam = await onboard(urban);
      for (let i = 0; i < INVITE_LIMIT; i++) {
        await as(glowTeam.ownerToken)
          .post('/members', {
            email: `s${i}@glow.example`,
            name: `S${i}`,
            role: 'STAFF',
          })
          .expect(201);
      }
      const res = await as(glowTeam.ownerToken)
        .post('/members', {
          email: 'late@glow.example',
          name: 'L',
          role: 'STAFF',
        })
        .expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(
        await admin.user.findUnique({ where: { email: 'late@glow.example' } }),
      ).toBeNull();
      // Another business has its own budget.
      await as(urbanTeam.ownerToken)
        .post('/members', {
          email: 'u@urban.example',
          name: 'U',
          role: 'STAFF',
        })
        .expect(201);
    });
  });

  describe('staff calendars', () => {
    it('any member lists calendars; a member renames only their own', async () => {
      const { ownerToken } = await onboard();
      const maya = await addActiveMember(ownerToken, {
        email: 'maya@glow.example',
        name: 'Maya',
        role: 'STAFF',
      });
      const ravi = await addActiveMember(ownerToken, {
        email: 'ravi@glow.example',
        name: 'Ravi',
        role: 'STAFF',
      });

      const list = await as(maya.token).get('/staff').expect(200);
      expect(list.body.items).toEqual([
        {
          id: maya.member.staffId,
          displayName: 'Maya',
          active: true,
          memberId: maya.id,
          userId: maya.member.userId,
        },
        expect.objectContaining({ id: ravi.member.staffId }),
      ]);

      const renamed = await as(maya.token)
        .patch(`/staff/${maya.member.staffId}`, { displayName: 'Maya R.' })
        .expect(200);
      expect(renamed.body.displayName).toBe('Maya R.');
      await as(maya.token)
        .patch(`/staff/${ravi.member.staffId}`, { displayName: 'Nope' })
        .expect(403);
      await as(maya.token)
        .patch(`/staff/${maya.member.staffId}`, { active: false })
        .expect(403);
    });

    it('a Manager deactivates a calendar: it leaves the public page at once', async () => {
      const { ownerToken } = await onboard();
      const manager = await addActiveMember(ownerToken, {
        email: 'manager@glow.example',
        name: 'Neha',
        role: 'MANAGER',
      });
      const maya = await addActiveMember(ownerToken, {
        email: 'maya@glow.example',
        name: 'Maya',
        role: 'STAFF',
      });
      expect(
        (await http().get('/public/glow-salon').expect(200)).body.staff,
      ).toEqual([{ id: maya.member.staffId, displayName: 'Maya' }]);

      await as(manager.token)
        .patch(`/staff/${maya.member.staffId}`, { active: false })
        .expect(200);
      expect(
        (await http().get('/public/glow-salon').expect(200)).body.staff,
      ).toEqual([]);
      const inactive = await as(maya.token)
        .get('/staff?active=false')
        .expect(200);
      expect(inactive.body.items).toHaveLength(1);
      const audit = await admin.auditLog.findFirstOrThrow({
        where: { action: 'staff.updated', entityId: maya.member.staffId },
      });
      expect(audit.before).toEqual({ active: true });
      expect(audit.after).toEqual({ active: false });
    });
  });
});
