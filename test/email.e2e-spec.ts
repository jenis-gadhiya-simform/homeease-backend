import type { INestApplication } from '@nestjs/common';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Requires Redis: `docker compose up -d`. Mail goes to an in-memory transport.
describe('Email (e2e)', () => {
  let app: INestApplication;
  let mails: InMemoryMailTransport;

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `e2e-email-${process.pid}`;
    const { AppModule } = await import('../src/modules/app/app.module.js');
    const { configureApp } = await import('../src/config/app.setup.js');

    mails = new InMemoryMailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(mails)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mails.clear();
  });

  it('queues a welcome email and the processor sends it', async () => {
    await request(app.getHttpServer())
      .post('/dev/emails/welcome')
      .send({ to: 'ada@example.com', name: 'Ada' })
      .expect(202);

    await vi.waitFor(
      () =>
        mails.assertSent({ to: 'ada@example.com', subject: 'Welcome, Ada!' }),
      {
        timeout: 5_000,
      },
    );
    const sent = mails.find({ to: 'ada@example.com' })!;
    expect(sent.text).toContain('Thanks for signing up');
    expect(sent.html).toContain('Get started');
  });

  it('escapes user data in the HTML', async () => {
    await request(app.getHttpServer())
      .post('/dev/emails/welcome')
      .send({ to: 'eve@example.com', name: '<script>x</script>' })
      .expect(202);

    await vi.waitFor(() => mails.assertSent({ to: 'eve@example.com' }), {
      timeout: 5_000,
    });
    const html = String(mails.find({ to: 'eve@example.com' })!.html);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects an invalid address with 400 and sends nothing', async () => {
    await request(app.getHttpServer())
      .post('/dev/emails/welcome')
      .send({ to: 'not-an-email' })
      .expect(400);
    expect(mails.mails).toHaveLength(0);
  });

  it('previews a template as HTML without sending', async () => {
    const res = await request(app.getHttpServer())
      .get('/dev/emails/preview/welcome?name=Grace')
      .expect(200)
      .expect('content-type', /text\/html/);
    expect(res.text).toContain('Welcome, Grace!');
    expect(mails.mails).toHaveLength(0);
  });
});
