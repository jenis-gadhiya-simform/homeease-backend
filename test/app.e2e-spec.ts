import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createClient } from 'redis';
import request from 'supertest';

// Requires Redis: `docker compose up -d` (REDIS_URL, default redis://localhost:6379).
const THROTTLE_LIMIT = 3;

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Module options read env at import time, so set it before importing.
    process.env.THROTTLE_LIMIT = String(THROTTLE_LIMIT);
    const { AppModule } = await import('../src/modules/app/app.module.js');
    const { configureApp } = await import('../src/config/app.setup.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    // Fresh rate-limit counters for every test.
    const redis = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    });
    await redis.connect();
    for await (const keys of redis.scanIterator({ MATCH: '_throttler:*' })) {
      if (keys.length) await redis.del(keys);
    }
    await redis.close();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns the greeting', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('GET /health is up without dependencies', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok' });
  });

  it('GET /ready reports Redis up', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { redis: { status: 'up' } },
    });
  });

  it('rate limits after the configured limit with Retry-After', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < THROTTLE_LIMIT; i++) {
      await request(server).get('/').expect(200);
    }
    const res = await request(server).get('/').expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('never rate limits the health probes', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < THROTTLE_LIMIT + 2; i++) {
      await request(server).get('/health').expect(200);
    }
  });

  it('sets security headers with helmet', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
