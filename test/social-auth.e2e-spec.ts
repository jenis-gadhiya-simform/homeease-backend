import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
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
} from './support/auth-app.js';
import { FakeGoogle, type FakeIdentity } from './support/fake-oidc-provider.js';

const APP_URL = 'http://localhost:5173';
const TX_COOKIE = '__Host-oidc_tx';

// Requires `docker compose up -d` (Postgres + Redis). Google is faked
// (discovery, JWKS, token endpoint); Microsoft stays disabled.
describe('Social sign-in (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: AdminPrismaService;
  const google = new FakeGoogle();
  const http = () => request(app.getHttpServer());

  const PASSWORD = 'correct horse battery';
  const asha: FakeIdentity = {
    sub: 'google-sub-asha',
    email: 'Asha@Gmail.com',
    email_verified: true,
    name: 'Asha',
  };

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-social-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.APP_URL = APP_URL;
    process.env.GOOGLE_CLIENT_ID = 'test-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    google.install();
    ({ app, prisma, admin } = await createTestApp());
  });

  afterAll(async () => {
    google.uninstall();
    await resetDatabase(admin);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(admin);
  });

  function setCookies(res: request.Response): string[] {
    return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  }

  /** The `name=value` of a Set-Cookie, for sending it back. */
  function cookiePair(res: request.Response, name: string) {
    const cookie = setCookies(res).find((c) => c.startsWith(`${name}=`));
    return cookie?.split(';')[0];
  }

  /** GET our login route; returns the provider URL and this browser's tx cookie. */
  async function startLogin(path = '/auth/customer/oidc/google/login') {
    const res = await http().get(path).expect(302);
    const txCookie = cookiePair(res, TX_COOKIE);
    expect(txCookie).toBeDefined();
    return { providerUrl: res.headers.location as string, txCookie: txCookie! };
  }

  /** The whole browser round trip: login → provider → callback. */
  async function socialLogin(
    identity: FakeIdentity,
    path?: string,
    overrides: { nonce?: string } = {},
  ) {
    const { providerUrl, txCookie } = await startLogin(path);
    const { code, state } = google.authorize(providerUrl, identity, overrides);
    const res = await http()
      .get(`/auth/customer/oidc/google/callback?code=${code}&state=${state}`)
      .set('Cookie', txCookie)
      .expect(302);
    return {
      res,
      location: new URL(res.headers.location as string),
      code,
      state,
      txCookie,
    };
  }

  async function accessTokenFrom(res: request.Response) {
    const refresh = refreshCookie(res);
    expect(refresh).toBeDefined();
    const refreshed = await http()
      .post('/auth/refresh')
      .set('Cookie', `sw_refresh=${refresh}`)
      .expect(200);
    return refreshed.body.accessToken as string;
  }

  async function customerWithPassword(email: string, verified = true) {
    return prisma.customerAccount.create({
      data: {
        email,
        passwordHash: await testHasher.hash(PASSWORD),
        emailVerifiedAt: verified ? new Date() : null,
      },
      select: { id: true },
    });
  }

  async function customerToken(email: string) {
    const res = await http()
      .post('/auth/customer/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  it('lists only the enabled providers; a disabled one is 404', async () => {
    await http()
      .get('/auth/customer/oidc/providers')
      .expect(200, { providers: ['google'] });
    await http().get('/auth/customer/oidc/microsoft/login').expect(404);
    await http().get('/auth/customer/oidc/github/login').expect(400);
  });

  describe('sign-up and sign-in', () => {
    it('creates a verified account on first sign-in, then reuses it', async () => {
      const first = await socialLogin(
        asha,
        '/auth/customer/oidc/google/login?redirectTo=%2Fbook%2Fglow-salon&tenantSlug=glow-salon',
      );

      expect(first.location.origin + first.location.pathname).toBe(
        `${APP_URL}/auth/social/callback`,
      );
      expect(first.location.searchParams.get('redirectTo')).toBe(
        '/book/glow-salon',
      );
      expect(first.location.searchParams.get('tenant')).toBe('glow-salon');
      expect(first.location.searchParams.has('error')).toBe(false);
      // No token in the URL; the access token comes from /auth/refresh.
      expect(first.res.headers.location).not.toMatch(
        /eyJ|accessToken|sw_refresh/,
      );
      expect(first.res.headers['cache-control']).toBe('no-store');

      const accessToken = await accessTokenFrom(first.res);
      expect(jwtPayload(accessToken)).toMatchObject({
        kind: 'customer',
        amr: ['oidc'],
      });
      const me = await http()
        .get('/me')
        .auth(accessToken, { type: 'bearer' })
        .expect(200);
      expect(me.body).toMatchObject({
        kind: 'customer',
        email: 'asha@gmail.com',
        emailVerified: true,
        hasPassword: false,
        identities: ['google'],
      });

      await socialLogin(asha);
      expect(await prisma.customerAccount.count()).toBe(1);
      const identities = await prisma.customerIdentity.findMany();
      expect(identities).toEqual([
        expect.objectContaining({
          provider: 'GOOGLE',
          subject: asha.sub,
          email: 'asha@gmail.com',
        }),
      ]);
    });

    it('joins an existing verified account with the same email instead of duplicating it', async () => {
      const existing = await customerWithPassword('asha@gmail.com');

      const { res, location } = await socialLogin(asha);

      expect(location.searchParams.has('error')).toBe(false);
      const token = await accessTokenFrom(res);
      expect(jwtPayload(token).sub).toBe(existing.id);
      expect(await prisma.customerAccount.count()).toBe(1);
      expect(
        await prisma.customerIdentity.count({
          where: { accountId: existing.id },
        }),
      ).toBe(1);
    });

    it('refuses to join an unverified account that someone controls (ACCOUNT_LINK_REQUIRED)', async () => {
      await customerWithPassword('asha@gmail.com', false);

      const { res, location } = await socialLogin(asha);

      expect(location.pathname).toBe('/auth/social/callback');
      expect(location.searchParams.get('error')).toBe('ACCOUNT_LINK_REQUIRED');
      expect(refreshCookie(res)).toBeUndefined();
      expect(await prisma.customerIdentity.count()).toBe(0);
    });

    it('claims an unverified, unused account (a magic link requested but never opened)', async () => {
      const shell = await prisma.customerAccount.create({
        data: { email: 'asha@gmail.com' },
        select: { id: true },
      });

      const { res } = await socialLogin(asha);

      expect(jwtPayload(await accessTokenFrom(res)).sub).toBe(shell.id);
      const account = await prisma.customerAccount.findUniqueOrThrow({
        where: { id: shell.id },
      });
      expect(account.emailVerifiedAt).not.toBeNull();
    });

    it('refuses a second Google account for the same email (PROVIDER_ALREADY_LINKED)', async () => {
      await socialLogin(asha);

      const { location } = await socialLogin({ ...asha, sub: 'another-sub' });

      expect(location.searchParams.get('error')).toBe(
        'PROVIDER_ALREADY_LINKED',
      );
      expect(await prisma.customerIdentity.count()).toBe(1);
    });

    it('never creates or joins an account from an unverified provider email (EMAIL_NOT_VERIFIED)', async () => {
      const { res, location } = await socialLogin({
        ...asha,
        email_verified: false,
      });

      expect(location.searchParams.get('error')).toBe('EMAIL_NOT_VERIFIED');
      expect(refreshCookie(res)).toBeUndefined();
      expect(await prisma.customerAccount.count()).toBe(0);
    });
  });

  describe('protocol checks', () => {
    it('rejects a callback without this browser’s login cookie', async () => {
      const { providerUrl } = await startLogin();
      const { code, state } = google.authorize(providerUrl, asha);

      const res = await http()
        .get(`/auth/customer/oidc/google/callback?code=${code}&state=${state}`)
        .expect(302);

      expect(new URL(res.headers.location).searchParams.get('error')).toBe(
        'SOCIAL_SIGN_IN_FAILED',
      );
      expect(refreshCookie(res)).toBeUndefined();
      expect(await prisma.customerAccount.count()).toBe(0);
    });

    it('rejects a tampered state and a replayed callback', async () => {
      const { providerUrl, txCookie } = await startLogin();
      const { code, state } = google.authorize(providerUrl, asha);
      const tampered = await http()
        .get(`/auth/customer/oidc/google/callback?code=${code}&state=${state}x`)
        .set('Cookie', txCookie)
        .expect(302);
      expect(new URL(tampered.headers.location).searchParams.get('error')).toBe(
        'SOCIAL_SIGN_IN_FAILED',
      );

      const first = await socialLogin(asha);
      const replay = await http()
        .get(
          `/auth/customer/oidc/google/callback?code=${first.code}&state=${first.state}`,
        )
        .set('Cookie', first.txCookie)
        .expect(302);
      expect(new URL(replay.headers.location).searchParams.get('error')).toBe(
        'SOCIAL_SIGN_IN_FAILED',
      );
    });

    it('rejects an ID token with the wrong nonce', async () => {
      const { location } = await socialLogin(asha, undefined, {
        nonce: 'not-the-nonce',
      });
      expect(location.searchParams.get('error')).toBe('SOCIAL_SIGN_IN_FAILED');
      expect(await prisma.customerAccount.count()).toBe(0);
    });

    it('reports a provider-side error (user cancelled) without details', async () => {
      const { txCookie, providerUrl } = await startLogin();
      const state = new URL(providerUrl).searchParams.get('state');
      const res = await http()
        .get(
          `/auth/customer/oidc/google/callback?error=access_denied&state=${state}`,
        )
        .set('Cookie', txCookie)
        .expect(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe(
        'SOCIAL_SIGN_IN_FAILED',
      );
    });

    it('rejects a redirectTo that leaves the web app', async () => {
      await http()
        .get('/auth/customer/oidc/google/login?redirectTo=%2F%2Fevil.example')
        .expect(400);
      await http()
        .get(
          '/auth/customer/oidc/google/login?redirectTo=https%3A%2F%2Fevil.example',
        )
        .expect(400);
    });
  });

  describe('linking from the account', () => {
    async function startLink(token: string) {
      const res = await http()
        .post('/me/identities/google/link')
        .auth(token, { type: 'bearer' })
        .expect(200);
      const url = new URL(res.body.url as string);
      expect(url.pathname).toBe('/auth/customer/oidc/google/login');
      return url.pathname + url.search;
    }

    it('links Google to the signed-in account, lists it, and unlinks it', async () => {
      const account = await customerWithPassword('asha@slotwise.example');
      const token = await customerToken('asha@slotwise.example');

      // The Google email differs from the account's: allowed when linking.
      const { res, location } = await socialLogin(asha, await startLink(token));

      expect(location.origin + location.pathname).toBe(
        `${APP_URL}/account/sign-in-methods`,
      );
      expect(location.searchParams.get('linked')).toBe('google');
      expect(refreshCookie(res)).toBeUndefined(); // linking doesn't sign in

      const list = await http()
        .get('/me/identities')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({
          provider: 'google',
          email: 'asha@gmail.com',
        }),
      ]);

      // The linked identity now signs in to this account.
      const again = await socialLogin(asha);
      expect(jwtPayload(await accessTokenFrom(again.res)).sub).toBe(account.id);

      await http()
        .delete('/me/identities/google')
        .auth(token, { type: 'bearer' })
        .expect(204);
      await http()
        .delete('/me/identities/google')
        .auth(token, { type: 'bearer' })
        .expect(404);
      expect(await prisma.customerIdentity.count()).toBe(0);
    });

    it('spends a link intent once', async () => {
      await customerWithPassword('asha@slotwise.example');
      const token = await customerToken('asha@slotwise.example');
      const path = await startLink(token);

      await http().get(path).expect(302);
      const reused = await http().get(path).expect(302);

      const location = new URL(reused.headers.location);
      expect(location.pathname).toBe('/account/sign-in-methods');
      expect(location.searchParams.get('error')).toBe('LINK_EXPIRED');
    });

    it('refuses an identity that belongs to another account (IDENTITY_IN_USE)', async () => {
      await socialLogin(asha); // Asha's Google now has its own account
      await customerWithPassword('ravi@slotwise.example');
      const token = await customerToken('ravi@slotwise.example');

      const { location } = await socialLogin(asha, await startLink(token));

      expect(location.pathname).toBe('/account/sign-in-methods');
      expect(location.searchParams.get('error')).toBe('IDENTITY_IN_USE');
    });

    it('is customer-only', async () => {
      await createActiveUser(prisma, {
        email: 'owner@glow.example',
        password: PASSWORD,
      });
      const staff = await http()
        .post('/auth/staff/login')
        .send({ email: 'owner@glow.example', password: PASSWORD })
        .expect(200);
      await http()
        .post('/me/identities/google/link')
        .auth(staff.body.accessToken as string, { type: 'bearer' })
        .expect(403);
      await http()
        .get('/me/identities')
        .auth(staff.body.accessToken as string, { type: 'bearer' })
        .expect(403);
    });
  });
});
