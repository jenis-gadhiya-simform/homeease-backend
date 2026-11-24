import { Controller, Get, HttpStatus } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { PrismaService as PrismaServiceType } from '../src/shared/database/prisma.service.js';

// Requires `docker compose up -d` (Postgres + Redis).
describe('Platform foundations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaServiceType;
  let isExclusionViolation: (error: unknown) => boolean;

  beforeAll(async () => {
    const { AppModule } = await import('../src/modules/app/app.module.js');
    const { configureApp } = await import('../src/config/app.setup.js');
    const { PrismaService } =
      await import('../src/shared/database/prisma.service.js');
    const { DomainError, ErrorCode } =
      await import('../src/shared/errors/domain-error.js');
    const { RequestContext } =
      await import('../src/shared/context/request-context.js');
    ({ isExclusionViolation } =
      await import('../src/shared/database/prisma-errors.js'));

    @Public()
    @Controller('test-errors')
    class ThrowingController {
      @Get('domain')
      domain() {
        throw new DomainError(
          HttpStatus.CONFLICT,
          ErrorCode.SlotTaken,
          'That slot was just booked',
        );
      }

      @Get('crash')
      crash() {
        throw new Error('database password is hunter2');
      }

      @Get('context')
      async context() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { requestId: RequestContext.requestId() };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrowingController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CORS', () => {
    const webApp = 'http://localhost:5173'; // APP_URL default

    it('lets the web app call the API with credentials (preflight)', async () => {
      const res = await request(app.getHttpServer())
        .options('/auth/refresh')
        .set('Origin', webApp)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(webApp);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-headers']).toContain(
        'Authorization',
      );
    });

    it('marks actual responses for the web app and exposes the request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', webApp)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(webApp);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-expose-headers']).toContain(
        'X-Request-Id',
      );
      expect(res.headers.vary).toContain('Origin');
    });

    it('gives no other origin CORS access', async () => {
      const preflight = await request(app.getHttpServer())
        .options('/auth/refresh')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('error envelope', () => {
    it('answers a domain error with its code and the request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-errors/domain')
        .set('X-Request-Id', 'e2e-domain-1')
        .expect(409);
      expect(res.headers['x-request-id']).toBe('e2e-domain-1');
      expect(res.body).toEqual({
        error: {
          code: 'SLOT_TAKEN',
          message: 'That slot was just booked',
          requestId: 'e2e-domain-1',
        },
      });
    });

    it('hides unexpected errors behind a generic 500', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-errors/crash')
        .expect(500);
      expect(res.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: res.headers['x-request-id'],
      });
    });

    it('wraps unknown routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/no-such-route')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });

    it('wraps validation errors with per-field details', async () => {
      const res = await request(app.getHttpServer())
        .post('/dev/emails/welcome')
        .send({ to: 'not-an-email' })
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.stringMatching(/^to: /)],
      });
    });

    it('wraps a malformed JSON body', async () => {
      const res = await request(app.getHttpServer())
        .post('/dev/emails/welcome')
        .set('Content-Type', 'application/json')
        .send('{"to":')
        .expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('keeps the Terminus body on the readiness probe', async () => {
      const res = await request(app.getHttpServer()).get('/ready').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });
  });

  describe('request context', () => {
    it('exposes the request id to code running in the request', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-errors/context')
        .expect(200);
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
      expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('replaces an unsafe incoming request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('X-Request-Id', 'bad id with spaces')
        .expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('database', () => {
    it('runs every session in UTC', async () => {
      const [row] = await prisma.$queryRaw<
        { timezone: string }[]
      >`SELECT current_setting('TimeZone') AS timezone`;
      expect(row.timezone).toBe('UTC');
    });

    it('recognises an exclusion violation (23P01) from Postgres', async () => {
      const error = await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`CREATE TEMP TABLE slot_probe (during tstzrange, EXCLUDE USING gist (during WITH &&)) ON COMMIT DROP`;
          await tx.$executeRaw`INSERT INTO slot_probe VALUES (tstzrange('2026-11-24 09:00Z', '2026-11-24 10:00Z'))`;
          await tx.$executeRaw`INSERT INTO slot_probe VALUES (tstzrange('2026-11-24 09:30Z', '2026-11-24 10:30Z'))`;
        })
        .catch((caught: unknown) => caught);
      expect(isExclusionViolation(error)).toBe(true);
    });
  });
});
