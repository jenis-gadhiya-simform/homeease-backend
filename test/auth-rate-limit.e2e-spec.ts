import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { AdminPrismaService } from '../src/shared/database/prisma.service.js';
import { createTestApp, resetDatabase } from './support/auth-app.js';

// Requires `docker compose up -d`. Its own file: the limit is read from env at import.
describe('Authentication rate limits (e2e)', () => {
  let app: NestExpressApplication;
  let admin: AdminPrismaService;
  const LIMIT = 3;

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-auth-rl-${process.pid}`;
    process.env.AUTH_THROTTLE_LIMIT = String(LIMIT);
    ({ app, admin } = await createTestApp());
  });

  afterAll(async () => {
    await resetDatabase(admin);
    await app.close();
  });

  it(`allows ${LIMIT} staff sign-in attempts per minute, then answers 429`, async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ email: 'brute@x.example', password: 'guess guess guess' });

    for (let i = 0; i < LIMIT; i++) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits magic-link requests per email', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/auth/customer/magic-link')
        .send({ email: 'flood@example.com' });

    // A fresh route: its per-IP budget is separate from the sign-in route's.
    for (let i = 0; i < LIMIT; i++) await send().expect(202);
    await send().expect(429);
  });
});
