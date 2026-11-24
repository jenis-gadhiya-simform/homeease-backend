import type { InMemoryMailTransport } from '@nestjs/mail';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { AccountSetupService as AccountSetupServiceType } from '../src/modules/auth/account-setup.service.js';
import type {
  AdminPrismaService,
  PrismaService,
} from '../src/shared/database/prisma.service.js';
import {
  createActiveUser,
  createTestApp,
  jwtPayload,
  refreshCookie,
  resetDatabase,
  testHasher,
  tokenFromMail,
  tokenFromUrl,
} from './support/auth-app.js';

// Requires `docker compose up -d` (Postgres + Redis). Mail is captured in memory.
describe('Authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  let mails: InMemoryMailTransport;
  let accountSetup: AccountSetupServiceType;
  const http = () => request(app.getHttpServer());

  const PASSWORD = 'correct horse battery';
  const NEW_PASSWORD = 'another long passphrase';

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-auth-${process.pid}`;
    // Rate limits have their own test file; keep them out of the way here.
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    ({ app, prisma, admin, mails } = await createTestApp());
    const { AccountSetupService } =
      await import('../src/modules/auth/account-setup.service.js');
    accountSetup = app.get(AccountSetupService);
  });

  afterAll(async () => {
    await resetDatabase(admin);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(admin);
    mails.clear();
  });

  const staffLogin = (email: string, password: string) =>
    http().post('/auth/staff/login').send({ email, password });

  /** A PENDING_SETUP user (as F01/F04 create them) and their setup link token. */
  async function pendingUser(email = 'owner@glow.example') {
    const user = await prisma.user.create({
      data: { email, name: 'Asha Patel' },
      select: { id: true },
    });
    const link = await accountSetup.createSetupLink(user.id);
    return { userId: user.id, token: tokenFromUrl(link.url), link };
  }

  describe('staff sign-in', () => {
    it('signs the platform admin in with pa: true and a refresh cookie', async () => {
      await createActiveUser(prisma, {
        email: 'admin@slotwise.local',
        password: PASSWORD,
        admin: true,
      });

      const res = await staffLogin('ADMIN@slotwise.local', PASSWORD).expect(
        200,
      );

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      expect(jwtPayload(res.body.accessToken)).toMatchObject({
        kind: 'staff',
        pa: true,
        amr: ['pwd'],
        iss: 'slotwise',
        aud: 'slotwise-api',
      });
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith('sw_refresh='),
      );
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Path=\/auth/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(res.body).not.toHaveProperty('refreshToken');

      const me = await http()
        .get('/me')
        .auth(res.body.accessToken, { type: 'bearer' })
        .expect(200);
      expect(me.body).toMatchObject({
        kind: 'staff',
        email: 'admin@slotwise.local',
        isPlatformAdmin: true,
      });
      expect(me.body).not.toHaveProperty('passwordHash');
    });

    it('answers unknown email, wrong password and pending user identically', async () => {
      await createActiveUser(prisma, {
        email: 'a@x.example',
        password: PASSWORD,
      });
      await pendingUser('pending@x.example');

      const responses = await Promise.all([
        staffLogin('nobody@x.example', PASSWORD),
        staffLogin('a@x.example', 'wrong password!!'),
        staffLogin('pending@x.example', PASSWORD),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(401);
        expect(res.body.error).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        expect(refreshCookie(res)).toBeUndefined();
      }
    });

    it('rejects a disabled user’s still-valid access token on the next request', async () => {
      const user = await createActiveUser(prisma, {
        email: 'staff@x.example',
        password: PASSWORD,
      });
      const { body } = await staffLogin('staff@x.example', PASSWORD).expect(
        200,
      );
      await http()
        .get('/me')
        .auth(body.accessToken, { type: 'bearer' })
        .expect(200);

      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'DISABLED' },
      });

      const res = await http()
        .get('/me')
        .auth(body.accessToken, { type: 'bearer' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      await staffLogin('staff@x.example', PASSWORD).expect(401);
    });

    it('requires a token on protected routes, in the error envelope', async () => {
      const res = await http().get('/me').expect(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
      await http().get('/me').auth('not-a-jwt', { type: 'bearer' }).expect(401);
    });
  });

  describe('account setup', () => {
    it('lets a pending user set a password once, then sign in', async () => {
      const { token } = await pendingUser();
      await staffLogin('owner@glow.example', PASSWORD).expect(401);

      const info = await http().get(`/auth/account-setup/${token}`).expect(200);
      expect(info.body).toEqual({
        email: 'owner@glow.example',
        name: 'Asha Patel',
        businessName: null,
      });

      // The password policy applies.
      const weak = await http()
        .post('/auth/account-setup')
        .send({ token, password: 'short' })
        .expect(400);
      expect(weak.body.error.code).toBe('VALIDATION_FAILED');

      const done = await http()
        .post('/auth/account-setup')
        .send({ token, password: PASSWORD })
        .expect(200);
      expect(jwtPayload(done.body.accessToken)).toMatchObject({
        kind: 'staff',
        pa: false,
      });
      expect(refreshCookie(done)).toBeDefined();

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'owner@glow.example' },
      });
      expect(user.status).toBe('ACTIVE');
      expect(user.emailVerifiedAt).not.toBeNull();
      await staffLogin('owner@glow.example', PASSWORD).expect(200);

      // Single use.
      const again = await http()
        .post('/auth/account-setup')
        .send({ token, password: NEW_PASSWORD })
        .expect(410);
      expect(again.body.error.code).toBe('LINK_EXPIRED');
      await http().get(`/auth/account-setup/${token}`).expect(410);
    });

    it('answers 410 for an expired link', async () => {
      const { userId, token } = await pendingUser();
      await prisma.accountSetupToken.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await http().get(`/auth/account-setup/${token}`).expect(410);
      await http()
        .post('/auth/account-setup')
        .send({ token, password: PASSWORD })
        .expect(410);
    });

    it('invalidates the previous link when a new one is created (resend)', async () => {
      const { userId, token: first } = await pendingUser();
      const second = tokenFromUrl(
        (await accountSetup.createSetupLink(userId)).url,
      );

      await http()
        .post('/auth/account-setup')
        .send({ token: first, password: PASSWORD })
        .expect(410);
      await http()
        .post('/auth/account-setup')
        .send({ token: second, password: PASSWORD })
        .expect(200);
    });

    it('lets exactly one of two concurrent submissions win', async () => {
      const { token } = await pendingUser();
      const results = await Promise.all([
        http().post('/auth/account-setup').send({ token, password: PASSWORD }),
        http()
          .post('/auth/account-setup')
          .send({ token, password: NEW_PASSWORD }),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 410,
      ]);
    });

    it('stores only the SHA-256 of the token, with a 72 h expiry', async () => {
      const { userId, token, link } = await pendingUser();
      const row = await prisma.accountSetupToken.findFirstOrThrow({
        where: { userId },
      });
      expect(row.tokenHash).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.purpose).toBe('SETUP');
      const hours = (link.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(71.9);
      expect(hours).toBeLessThanOrEqual(72);
    });
  });

  describe('refresh tokens', () => {
    async function signedIn() {
      await createActiveUser(prisma, {
        email: 'r@x.example',
        password: PASSWORD,
      });
      const res = await staffLogin('r@x.example', PASSWORD).expect(200);
      return refreshCookie(res)!;
    }
    const refresh = (token: string) =>
      http().post('/auth/refresh').set('Cookie', `sw_refresh=${token}`);

    it('rotates: a refresh returns a new access token and a new cookie', async () => {
      const first = await signedIn();
      const res = await refresh(first).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(jwtPayload(res.body.accessToken)).toMatchObject({ kind: 'staff' });
      const second = refreshCookie(res);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      await refresh(second!).expect(200);
    });

    it('revokes the whole family when a used refresh token comes back', async () => {
      const first = await signedIn();
      const second = refreshCookie(await refresh(first).expect(200))!;

      await refresh(first).expect(401); // reuse: someone else holds it
      await refresh(second).expect(401); // so the newer one dies too
    });

    it('answers 401 without a cookie', async () => {
      const res = await http().post('/auth/refresh').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('logout revokes the refresh token and clears the cookie', async () => {
      const token = await signedIn();
      const res = await http()
        .post('/auth/logout')
        .set('Cookie', `sw_refresh=${token}`)
        .expect(204);
      expect(String(res.headers['set-cookie'])).toMatch(/sw_refresh=;/);
      await refresh(token).expect(401);
    });
  });

  describe('customer magic link', () => {
    const requestLink = (email: string) =>
      http()
        .post('/auth/customer/magic-link')
        .send({ email, tenantSlug: 'glow-salon' });

    it('creates the account, emails a single-use link and signs in with it', async () => {
      const res = await requestLink('Cust@Example.com').expect(202);
      expect(res.body).toEqual({});

      const token = await tokenFromMail(mails, 'cust@example.com');
      const mail = mails.find({ to: 'cust@example.com' })!;
      expect(mail.subject).toBe('Your SlotWise sign-in link');
      expect(String(mail.text)).toContain('tenant=glow-salon');

      const signIn = await http()
        .post('/auth/customer/magic-link/verify')
        .send({ token })
        .expect(200);
      expect(jwtPayload(signIn.body.accessToken)).toMatchObject({
        kind: 'customer',
        amr: ['email'],
      });
      const me = await http()
        .get('/me')
        .auth(signIn.body.accessToken, { type: 'bearer' })
        .expect(200);
      expect(me.body).toMatchObject({
        kind: 'customer',
        email: 'cust@example.com',
        hasPassword: false,
        emailVerified: true,
      });

      await http()
        .post('/auth/customer/magic-link/verify')
        .send({ token })
        .expect(410);
    });

    it('answers the same for new and existing emails (no enumeration)', async () => {
      await prisma.customerAccount.create({
        data: { email: 'known@example.com' },
      });
      const known = await requestLink('known@example.com');
      const unknown = await requestLink('unknown@example.com');
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(known.body).toEqual(unknown.body);
    });

    it('answers 410 for an expired link', async () => {
      await requestLink('late@example.com').expect(202);
      const token = await tokenFromMail(mails, 'late@example.com');
      await prisma.magicLinkToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await http()
        .post('/auth/customer/magic-link/verify')
        .send({ token })
        .expect(410);
    });
  });

  describe('customer password', () => {
    async function magicLinkSession(email: string) {
      await http()
        .post('/auth/customer/magic-link')
        .send({ email })
        .expect(202);
      const token = await tokenFromMail(mails, email);
      const res = await http()
        .post('/auth/customer/magic-link/verify')
        .send({ token })
        .expect(200);
      return res.body.accessToken as string;
    }
    const setPassword = (accessToken: string, body: object) =>
      http()
        .post('/me/password')
        .auth(accessToken, { type: 'bearer' })
        .send(body);

    it('sets a first password after a fresh magic link, then requires the current one', async () => {
      const access = await magicLinkSession('pw@example.com');
      const set = await setPassword(access, { newPassword: PASSWORD }).expect(
        200,
      );
      expect(jwtPayload(set.body.accessToken)).toMatchObject({ amr: ['pwd'] });

      const login = await http()
        .post('/auth/customer/login')
        .send({ email: 'pw@example.com', password: PASSWORD })
        .expect(200);
      const pwdAccess = login.body.accessToken as string;

      const noCurrent = await setPassword(pwdAccess, {
        newPassword: NEW_PASSWORD,
      }).expect(403);
      expect(noCurrent.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
      await setPassword(pwdAccess, {
        currentPassword: 'wrong password!!',
        newPassword: NEW_PASSWORD,
      }).expect(403);
      await setPassword(pwdAccess, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(200);

      await http()
        .post('/auth/customer/login')
        .send({ email: 'pw@example.com', password: PASSWORD })
        .expect(401);
    });

    it('rejects a magic-link-only customer at password login', async () => {
      await magicLinkSession('nopw@example.com');
      const res = await http()
        .post('/auth/customer/login')
        .send({ email: 'nopw@example.com', password: PASSWORD })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('staff and customer tokens are kept apart', () => {
    it('rejects a staff token on a customer endpoint', async () => {
      await createActiveUser(prisma, {
        email: 's@x.example',
        password: PASSWORD,
      });
      const { body } = await staffLogin('s@x.example', PASSWORD).expect(200);
      const res = await http()
        .post('/me/password')
        .auth(body.accessToken, { type: 'bearer' })
        .send({ newPassword: NEW_PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('WRONG_ACCOUNT_TYPE');
    });

    it('does not accept a customer password at staff login', async () => {
      await prisma.customerAccount.create({
        data: {
          email: 'both@example.com',
          passwordHash: await testHasher.hash(PASSWORD),
        },
      });
      await staffLogin('both@example.com', PASSWORD).expect(401);
    });
  });

  describe('password reset', () => {
    it('resets a staff password and signs out every device', async () => {
      await createActiveUser(prisma, {
        email: 'forgot@x.example',
        password: PASSWORD,
        name: 'Ravi',
      });
      const before = await staffLogin('forgot@x.example', PASSWORD).expect(200);
      const oldRefresh = refreshCookie(before)!;

      const known = await http()
        .post('/auth/password/forgot')
        .send({ email: 'forgot@x.example', accountType: 'staff' })
        .expect(202);
      const unknown = await http()
        .post('/auth/password/forgot')
        .send({ email: 'ghost@x.example', accountType: 'staff' })
        .expect(202);
      expect(known.body).toEqual(unknown.body);

      const token = await tokenFromMail(
        mails,
        'forgot@x.example',
        'Reset your SlotWise password',
      );
      expect(String(mails.find({ to: 'forgot@x.example' })!.text)).toContain(
        'Hi Ravi',
      );

      await http()
        .post('/auth/password/reset')
        .send({ token, accountType: 'staff', password: NEW_PASSWORD })
        .expect(204);

      await staffLogin('forgot@x.example', PASSWORD).expect(401);
      await staffLogin('forgot@x.example', NEW_PASSWORD).expect(200);
      await http()
        .post('/auth/refresh')
        .set('Cookie', `sw_refresh=${oldRefresh}`)
        .expect(401);
      await http()
        .post('/auth/password/reset')
        .send({ token, accountType: 'staff', password: PASSWORD })
        .expect(410);
      // Only unknown/known matter for the response; no mail for the unknown one.
      expect(mails.find({ to: 'ghost@x.example' })).toBeUndefined();
    });

    it('resets a customer password', async () => {
      await prisma.customerAccount.create({ data: { email: 'c@example.com' } });
      await http()
        .post('/auth/password/forgot')
        .send({ email: 'c@example.com', accountType: 'customer' })
        .expect(202);
      const token = await tokenFromMail(mails, 'c@example.com');

      // A staff reset can't spend a customer link.
      await http()
        .post('/auth/password/reset')
        .send({ token, accountType: 'staff', password: PASSWORD })
        .expect(410);
      await http()
        .post('/auth/password/reset')
        .send({ token, accountType: 'customer', password: PASSWORD })
        .expect(204);
      await http()
        .post('/auth/customer/login')
        .send({ email: 'c@example.com', password: PASSWORD })
        .expect(200);
    });
  });
});
